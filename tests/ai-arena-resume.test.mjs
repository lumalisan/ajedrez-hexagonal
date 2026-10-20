import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

it('rejects a reference checkout with different engine rules', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hex-reference-'));
  try {
    await mkdir(join(directory, 'src'));
    await writeFile(join(directory, 'src/engine.ts'), '// Different rules cannot be compared.');
    await expect(
      promisify(execFile)(
        process.execPath,
        [
          resolve(root, 'scripts/ai/arena.mjs'),
          '--model',
          resolve(root, 'src/ai-models/hex-value.bin'),
          '--reference-root',
          directory,
          '--output',
          join(directory, 'arena.json'),
        ],
        { cwd: root },
      ),
    ).rejects.toThrow(/mismas reglas/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

it('ends an impossible tournament without treating unfinished games as draws', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hex-rejection-'));
  const output = join(directory, 'arena.json');
  try {
    await promisify(execFile)(
      process.execPath,
      [
        resolve(root, 'scripts/ai/arena.mjs'),
        '--model',
        resolve(root, 'src/ai-models/hex-value.bin'),
        '--pairs',
        '8',
        '--budget-ms',
        '20',
        '--depth',
        '1',
        '--max-plies',
        '1',
        '--stop-on-rejection',
        '--output',
        output,
      ],
      { cwd: root },
    );
    const report = JSON.parse(await readFile(output, 'utf8'));
    expect(report.status).toBe('rejected');
    expect(report.games).toHaveLength(4);
    expect(report.summary.inconclusive).toBe(4);
    expect(report.summary.draws).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);

it('resumes an interrupted real arena from its checkpoint and preserves completed reports', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hex-arena-'));
  const output = join(directory, 'arena.json');
  const args = [
    resolve(root, 'scripts/ai/arena.mjs'),
    '--model',
    resolve(root, 'src/ai-models/hex-value.bin'),
    '--reference-model',
    resolve(root, 'src/ai-models/hex-value.bin'),
    '--reference-root',
    root,
    '--pairs',
    '1',
    '--budget-ms',
    '100',
    '--depth',
    '1',
    '--max-plies',
    '12',
    '--output',
    output,
  ];
  let child;
  const launch = (extra = []) => {
    child = spawn(process.execPath, [...args, ...extra], { cwd: root, stdio: 'pipe' });
    let errors = '';
    child.stdout.resume();
    child.stderr.on('data', (data) => {
      errors += data;
    });
    return new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => accept({ code, errors }));
    });
  };
  try {
    const interrupted = launch();
    let partial;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      try {
        const report = JSON.parse(await readFile(output, 'utf8'));
        if (report.inProgress) {
          partial = report.inProgress;
          break;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await delay(25);
    }
    expect(partial).toBeDefined();
    child.kill();
    await interrupted;
    expect(await launch(['--resume'])).toEqual({ code: 0, errors: '' });
    const text = await readFile(output, 'utf8');
    const result = JSON.parse(text);
    expect(result.status).toBe('complete');
    expect(result.games).toHaveLength(2);
    expect(result.games[0].searches.slice(0, partial.searches.length)).toEqual(partial.searches);
    expect(result.games[0].actions.slice(0, partial.actions.length)).toEqual(partial.actions);
    for (const kind of ['neural', 'classical']) {
      expect(result.metrics[kind].searches).toBe(
        result.games.reduce(
          (total, game) =>
            total + game.searches.filter((search) => search.evaluator === kind).length,
          0,
        ),
      );
    }
    expect(await launch(['--resume'])).toEqual({ code: 0, errors: '' });
    expect(await readFile(output, 'utf8')).toBe(text);
  } finally {
    child?.kill();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
