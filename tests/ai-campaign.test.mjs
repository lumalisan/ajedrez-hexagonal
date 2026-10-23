import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { stopCampaignChild } from '../scripts/ai/campaign.mjs';
import { verifyCampaignRuntime } from '../scripts/ai/campaign-data.mjs';
import { canonicalJson } from '../scripts/ai/research-data.mjs';

const temporaryDirectories = [];
const root = fileURLToPath(new URL('../', import.meta.url));
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((accept, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`El proceso propio ${child.pid} no terminó.`)),
      10000,
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      accept();
    });
  });
}

function readyMessage(child) {
  return new Promise((accept, reject) => {
    let received = '';
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = () => {
      cleanup();
      reject(new Error('El árbol terminó antes de comunicar sus PID.'));
    };
    const onData = (chunk) => {
      received += chunk.toString();
      while (received.includes('\n')) {
        const line = received.slice(0, received.indexOf('\n'));
        received = received.slice(received.indexOf('\n') + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (!Number.isSafeInteger(message?.parent) || !Number.isSafeInteger(message?.worker))
          continue;
        cleanup();
        accept(message);
        return;
      }
    };
    const timer = setTimeout(
      () => onError(new Error('El árbol propio no comunicó sus PID.')),
      10000,
    );
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function checkOwnedTree(executable, workerArguments) {
  const program = `
    const { spawn } = require('node:child_process');
    const worker = spawn(${JSON.stringify(executable)}, ${JSON.stringify(workerArguments)}, {
      windowsHide: true, stdio: 'ignore'
    });
    worker.once('error', (error) => { console.error(error.message); process.exit(1); });
    worker.once('spawn', () => {
      process.stdout.write(JSON.stringify({ parent: process.pid, worker: worker.pid }) + '\\n');
    });
    process.stdin.once('data', () => {
      if (worker.exitCode !== null || worker.signalCode !== null) process.exit(0);
      worker.once('exit', () => process.exit(0));
      worker.kill();
    });
    process.on('message', (message) => {
      if (message?.type !== 'hex-ai-stop') return;
      if (worker.exitCode !== null || worker.signalCode !== null) process.exit(0);
      worker.once('exit', () => process.exit(0));
      worker.kill();
    });
    setInterval(() => {}, 60000);
  `;
  const tree = spawn(process.execPath, ['-e', program], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  const spectator = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  let identities;
  tree.managesDescendants = true;
  spectator.managesDescendants = false;
  try {
    identities = await readyMessage(tree);
    expect(identities.parent).toBe(tree.pid);
    expect(identities.worker).not.toBe(tree.pid);
    expect(isAlive(identities.worker)).toBe(true);
    const exited = waitForExit(tree);
    void exited.catch(() => {});
    await stopCampaignChild(tree);
    await exited;
    expect(isAlive(identities.parent)).toBe(false);
    expect(isAlive(identities.worker)).toBe(false);
    // The same executable outside the target tree must remain running.
    expect(isAlive(spectator.pid)).toBe(true);
  } finally {
    // Graceful stdin cleanup uses the child's own live worker handle even when
    // taskkill's process enumeration is denied by a restricted Windows host.
    if (tree.exitCode === null && tree.signalCode === null) tree.stdin.end('stop\n');
    if (spectator.exitCode === null && spectator.signalCode === null) spectator.kill();
    await Promise.allSettled([waitForExit(tree), waitForExit(spectator)]);
  }
}

describe('campaign supervisor isolation', () => {
  it.skipIf(process.platform !== 'win32')(
    'terminates only its own Node child and grandchild tree',
    async () => {
      await checkOwnedTree(process.execPath, ['-e', 'setInterval(() => {}, 60000)']);
    },
    20000,
  );

  it.skipIf(process.platform !== 'win32' || !process.env.AI_PYTHON)(
    'terminates its own nested Python worker and leaves an unrelated Node alive',
    async () => {
      await checkOwnedTree(process.env.AI_PYTHON, [
        '-B',
        '-c',
        'import threading; threading.Event().wait()',
      ]);
    },
    20000,
  );

  it.skipIf(!process.env.AI_PYTHON)(
    'cancels the real sweep CLI and its exact Python handle without leaving a lock',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'hex-sweep-cancellation-'));
      temporaryDirectories.push(directory);
      await mkdir(resolve(directory, 'scripts/ai'), { recursive: true });
      await mkdir(resolve(directory, 'tests/fixtures'), { recursive: true });
      await mkdir(resolve(directory, 'src'));
      await mkdir(resolve(directory, '.ai-lab'));
      for (const file of ['sweep.mjs', 'shared.mjs', 'research-state.mjs', 'selfplay-policy.mjs'])
        await copyFile(resolve(root, 'scripts/ai', file), resolve(directory, 'scripts/ai', file));
      await writeFile(resolve(directory, 'package.json'), '{"type":"module"}');
      await writeFile(resolve(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
      await writeFile(resolve(directory, 'tests/fixtures/ai-strategic-positions.json'), '{}');
      await writeFile(resolve(directory, 'input.jsonl'), 'control-only-dataset');
      await writeFile(resolve(directory, 'initial.bin'), 'control-only-model');
      await writeFile(
        resolve(directory, 'scripts/ai/train.py'),
        `
import json, os, threading
print(json.dumps({"parent": os.getppid(), "worker": os.getpid()}), flush=True)
threading.Event().wait(20)
`,
      );
      const experiment = resolve(directory, '.ai-lab/experiment');
      const sweep = spawn(
        process.execPath,
        [
          resolve(directory, 'scripts/ai/sweep.mjs'),
          '--input',
          resolve(directory, 'input.jsonl'),
          '--model',
          resolve(directory, 'initial.bin'),
          '--directory',
          experiment,
          '--learning-rates',
          '0.0002',
          '--losses',
          'mse',
          '--seeds',
          '1',
          '--epochs',
          '1',
        ],
        {
          cwd: directory,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          env: { ...process.env, PYTHONUTF8: '1' },
        },
      );
      sweep.managesDescendants = true;
      let identities;
      try {
        identities = await readyMessage(sweep);
        expect(identities.parent).toBe(sweep.pid);
        expect(isAlive(identities.worker)).toBe(true);
        await stopCampaignChild(sweep);
        expect(isAlive(identities.worker)).toBe(false);
        const checkpoint = JSON.parse(await readFile(resolve(experiment, 'progress.json'), 'utf8'));
        expect(checkpoint.status).toBe('interrupted');
        expect(checkpoint.published).toBe(false);
        expect(checkpoint.completed).toEqual({});
        await expect(readFile(resolve(experiment, 'run.lock'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
        expect(await readFile(resolve(directory, 'initial.bin'), 'utf8')).toBe(
          'control-only-model',
        );
      } finally {
        if (identities && isAlive(identities.worker)) process.kill(identities.worker, 'SIGTERM');
        if (sweep.exitCode === null && sweep.signalCode === null) sweep.kill();
        await waitForExit(sweep);
      }
    },
    20000,
  );

  it('rejects a snapshot whose file list was edited without updating its digest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hex-campaign-manifest-'));
    temporaryDirectories.push(directory);
    const source = 'frozen-source';
    await writeFile(join(directory, 'engine.mjs'), source);
    const files = { 'engine.mjs': createHash('sha256').update(source).digest('hex') };
    const manifest = {
      format: 'hex-campaign-runtime-v1',
      files,
      sha256: createHash('sha256').update(canonicalJson(files)).digest('hex'),
    };
    await writeFile(join(directory, 'snapshot.json'), JSON.stringify(manifest));
    expect((await verifyCampaignRuntime(directory)).sha256).toBe(manifest.sha256);
    await writeFile(join(directory, 'snapshot.json'), JSON.stringify({ ...manifest, files: {} }));
    await expect(verifyCampaignRuntime(directory)).rejects.toThrow(/manifiesto/);
    expect(await readFile(join(directory, 'engine.mjs'), 'utf8')).toBe(source);
  });
});
