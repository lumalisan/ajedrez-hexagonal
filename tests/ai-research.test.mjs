import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { acquireResearchLock, researchFingerprint } from '../scripts/ai/research-state.mjs';
import { researchVariants, runResearch } from '../scripts/ai/research.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('reproducible research protocol', () => {
  it('uses matching seeds for objectives and learning-curve sizes', () => {
    const variants = researchVariants({
      losses: 'mse,huber',
      'training-games': '8,0',
      seeds: 2,
      seed: 17,
    });
    expect(variants).toHaveLength(8);
    expect(variants[0].seed).toBe(variants[2].seed);
    expect(variants[0].seed).toBe(variants[4].seed);
    expect(variants[0].seed).not.toBe(variants[1].seed);
    expect(() =>
      researchVariants({ losses: 'mse,mse', 'training-games': '0', seeds: 1, seed: 17 }),
    ).toThrow(/duplicados/);
    expect(() =>
      researchVariants({ losses: 'mse', 'training-games': 'NaN', seeds: 1, seed: 17 }),
    ).toThrow(/enteros/);
  });

  it('refuses to steal an active lock and releases only its own token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hex-research-'));
    const path = join(directory, 'run.lock');
    try {
      const release = await acquireResearchLock(path);
      await expect(acquireResearchLock(path, true)).rejects.toThrow(/activo/);
      expect(JSON.parse(await readFile(path, 'utf8')).pid).toBe(process.pid);
      await release();
      await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('recovers a verified dead PID only when resuming', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hex-research-stale-'));
    const path = join(directory, 'run.lock');
    try {
      // Windows PIDs are bounded; this value cannot belong to a live process.
      await writeFile(path, JSON.stringify({ pid: 2147483647, token: 'stale' }));
      await expect(acquireResearchLock(path)).rejects.toThrow(/huérfano/);
      const release = await acquireResearchLock(path, true);
      expect(JSON.parse(await readFile(path, 'utf8')).token).not.toBe('stale');
      await release();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fingerprints the benchmark fixture as well as executable sources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hex-research-sources-'));
    try {
      await mkdir(join(directory, 'src'));
      await mkdir(join(directory, 'scripts/ai'), { recursive: true });
      await mkdir(join(directory, 'tests/fixtures'), { recursive: true });
      await writeFile(join(directory, 'package.json'), '{}');
      await writeFile(join(directory, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
      const fixture = join(directory, 'tests/fixtures/ai-strategic-positions.json');
      await writeFile(fixture, '{"cases":[]}');
      const before = await researchFingerprint(directory);
      await writeFile(fixture, '{"cases":[1]}');
      expect(await researchFingerprint(directory)).not.toBe(before);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  // Fingerprinting real source files and the frozen model can exceed 5s under coverage or load.
  it('records budget exhaustion, releases the lock and rejects a changed frozen model on resume', async () => {
    await mkdir(join(root, '.ai-lab'), { recursive: true });
    const directory = await mkdtemp(join(root, '.ai-lab/research-regression-'));
    const input = join(directory, 'input.jsonl');
    await writeFile(input, 'not reached before budget check');
    const options = {
      directory,
      input,
      model: join(root, 'src/ai-models/hex-value.bin'),
      losses: 'mse',
      'training-games': '0',
      seeds: 1,
      seed: 17,
      'max-runtime-minutes': 0,
    };
    try {
      await expect(runResearch(options)).rejects.toThrow(/Presupuesto/);
      const checkpoint = join(directory, 'progress.json');
      expect(JSON.parse(await readFile(checkpoint, 'utf8')).status).toBe('budget-exhausted');
      await expect(readFile(join(directory, 'run.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
      await writeFile(join(directory, 'champion.bin'), 'modified');
      await expect(runResearch({ ...options, resume: true })).rejects.toThrow(/campeón congelado/);
    } finally {
      // mkdtemp returns a newly created directory under this exact workspace prefix.
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
