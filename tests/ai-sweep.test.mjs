import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { runSweep, sweepCancellation, sweepOptions, sweepVariants } from '../scripts/ai/sweep.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  await mkdir(resolve(root, '.ai-lab'), { recursive: true });
  const directory = await mkdtemp(resolve(root, '.ai-lab/sweep-test-'));
  temporaryDirectories.push(directory);
  const input = resolve(directory, 'input.jsonl');
  const model = resolve(directory, 'base.bin');
  await writeFile(input, 'frozen-dataset');
  await writeFile(model, 'frozen-model');
  const options = sweepOptions([
    '--input',
    input,
    '--model',
    model,
    '--directory',
    resolve(directory, 'experiment'),
    '--learning-rates',
    '0.0002',
    '--losses',
    'mse',
    '--seeds',
    '2',
    '--epochs',
    '1',
  ]);
  const argsSeen = [];
  const train = async (args) => {
    argsSeen.push(args);
    const output = args[args.indexOf('--output') + 1];
    await writeFile(output, `trained-${args[args.indexOf('--seed') + 1]}`);
    await writeFile(
      `${output}.training.json`,
      JSON.stringify({ bestEpoch: 1, loss: { validation: 0.1 }, split: {} }),
    );
    await writeFile(`${output}.parity.json`, '{}');
  };
  return { options, train, argsSeen };
}

describe('frozen-dataset training sweep', () => {
  it('cancels through its parent channel and removes the listener when disposed', () => {
    const channel = new EventEmitter();
    let stopSignals = 0;
    channel.on('SIGTERM', () => {
      stopSignals += 1;
    });
    const cancellation = sweepCancellation(channel);
    channel.emit('message', { type: 'unrelated' });
    expect(() => cancellation.check()).not.toThrow();
    channel.emit('message', { type: 'hex-ai-stop' });
    expect(stopSignals).toBe(1);
    expect(() => cancellation.check()).toThrow(/cancelado/);
    cancellation.dispose();
    expect(channel.listenerCount('message')).toBe(0);
  });
  it('compares losses and rates with matching seeds and rejects invalid settings', () => {
    const options = sweepOptions(['--input', 'dataset', '--directory', '.ai-lab/new']);
    const variants = sweepVariants(options);
    expect(variants).toHaveLength(12);
    expect(variants[0].seed).toBe(variants[3].seed);
    expect(variants[0].seed).toBe(variants[6].seed);
    expect(variants[0].seed).not.toBe(variants[1].seed);
    expect(() => sweepVariants({ ...options, 'batch-size': 3 })).toThrow(/par/);
    expect(() => sweepVariants({ ...options, 'learning-rates': '0.1,0.10' })).toThrow(/duplicados/);
    expect(() => sweepVariants({ ...options, 'sample-weighting': 'magic' })).toThrow(
      /sample-weighting/,
    );
  });

  it('resumes unfinished work while retaining verified completed variants', async () => {
    const { options, train, argsSeen } = await fixture();
    let invocation = 0;
    const interruptedTrain = async (args) => {
      invocation += 1;
      if (invocation === 2) {
        const error = new Error('simulated time budget');
        error.sweepStatus = 'budget-exhausted';
        throw error;
      }
      await train(args);
    };
    await expect(
      runSweep(options, { fingerprint: async () => 'sources', train: interruptedTrain }),
    ).rejects.toThrow(/time budget/);
    const checkpoint = resolve(options.directory, 'progress.json');
    const interrupted = JSON.parse(await readFile(checkpoint, 'utf8'));
    expect(interrupted.status).toBe('budget-exhausted');
    expect(Object.keys(interrupted.completed)).toHaveLength(1);
    const firstCompleted = Object.values(interrupted.completed)[0];
    const resumed = await runSweep(
      { ...options, resume: true, 'max-runtime-minutes': 2 },
      { fingerprint: async () => 'sources', train },
    );
    expect(resumed.status).toBe('complete');
    expect(resumed.promotionAllowed).toBe(false);
    expect(Object.keys(resumed.completed)).toHaveLength(2);
    expect(resumed.completed[firstCompleted.id].finishedAt).toBe(firstCompleted.finishedAt);
    expect(argsSeen).toHaveLength(2);
    expect(argsSeen[0]).toContain('--batch-size');
    expect(argsSeen[0]).toContain('--split-group-field');
    await expect(readFile(resolve(options.directory, 'run.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses changed frozen input, completed output and source identity', async () => {
    for (const modification of ['input', 'output', 'sources']) {
      const { options, train, argsSeen } = await fixture();
      const state = await runSweep(options, { fingerprint: async () => 'sources', train });
      if (modification === 'input')
        await writeFile(resolve(options.directory, 'positions.jsonl'), 'changed');
      if (modification === 'output')
        await writeFile(Object.values(state.completed)[0].model, 'changed');
      const snapshot = await readFile(resolve(options.directory, 'progress.json'), 'utf8');
      await expect(
        runSweep(
          { ...options, resume: true },
          {
            fingerprint: async () => (modification === 'sources' ? 'changed-sources' : 'sources'),
            train,
          },
        ),
      ).rejects.toThrow(/modificado|cambiado/);
      expect(argsSeen).toHaveLength(2);
      if (modification === 'sources')
        expect(await readFile(resolve(options.directory, 'progress.json'), 'utf8')).toBe(snapshot);
    }
  });
});
