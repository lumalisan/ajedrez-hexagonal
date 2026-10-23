import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as engine from '../src/engine';
import * as setup from '../src/setup';
import {
  freshOpening,
  createFreshSnapshot,
  freshTrajectoryOptions,
  openingFamilyId,
  runFreshTrajectories,
} from '../scripts/ai/fresh-trajectories.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const modules = { engine, setup, ai: {} };
const dependencies = {
  modules,
  toolHashes: { tool: 'fixed' },
  snapshot: { runtime: 'injected', files: { source: 'frozen' } },
};

async function options(role, games = 2) {
  const directory = await mkdtemp(join(tmpdir(), 'hex-fresh-'));
  directories.push(directory);
  return freshTrajectoryOptions([
    '--role',
    role,
    '--games',
    String(games),
    '--directory',
    directory,
    '--seed',
    '23651',
    '--max-plies',
    '4',
    '--budget-ms',
    '20',
    '--depth',
    '1',
  ]);
}

function classic(position, config) {
  expect(config.evaluate).toBeUndefined();
  expect(config.searchProfile).toBe('pvs-threats');
  expect(config.rangedPlay).toBe(true);
  expect(['balanced', 'aggressive', 'guardian', 'ambush']).toContain(config.personality);
  return {
    action: engine.getAllLegalActions(position)[0],
    metadata: {
      completedDepth: 1,
      requestedDepth: config.depth,
      score: 0,
      nodes: 1,
      timedOut: false,
      elapsedMs: 1,
      candidatesConsidered: 1,
    },
  };
}

describe('fresh classical trajectories and confirmation isolation', () => {
  it('copies teacher sources from the explicit reference root while retaining current tool helpers', async () => {
    const config = await options('development');
    const firstReference = join(config.directory, 'classic-v1');
    const secondReference = join(config.directory, 'different-classic');
    for (const [path, source] of [
      [firstReference, 'export const teacher = 1;'],
      [secondReference, 'export const teacher = 2;'],
    ]) {
      await mkdir(join(path, 'src'), { recursive: true });
      await writeFile(join(path, 'src/engine.ts'), source);
      await writeFile(join(path, 'package.json'), '{"type":"module"}');
    }
    const first = await createFreshSnapshot(join(config.directory, 'snapshot-first'), {
      referenceRoot: firstReference,
    });
    const second = await createFreshSnapshot(join(config.directory, 'snapshot-second'), {
      referenceRoot: secondReference,
    });
    expect(await readFile(join(first.runtime, 'src/engine.ts'), 'utf8')).toBe(
      'export const teacher = 1;',
    );
    expect(first.files['src/engine.ts']).not.toBe(second.files['src/engine.ts']);
    expect(first.files['scripts/ai/fresh-trajectories.mjs']).toBe(
      second.files['scripts/ai/fresh-trajectories.mjs'],
    );
    expect(first.referenceRoot).toBe(firstReference);
  });

  it('generates distinct model-free confirmation families and independent mixture choices', async () => {
    const config = await options('confirmation', 30);
    const search = vi.fn(() => {
      throw new Error('Confirmation must not search');
    });
    const state = await runFreshTrajectories(config, { ...dependencies, search });
    expect(state.status).toBe('complete');
    expect(state.games).toHaveLength(30);
    expect(new Set(state.games.map((game) => game.familyId)).size).toBe(30);
    expect(search).not.toHaveBeenCalled();
    expect(state.searches).toBe(0);
    const combinations = new Set(
      state.games.map((game) => `${game.initialLayout}:${game.fortressHp}`),
    );
    expect(combinations.size).toBe(6);
    expect(
      state.games.some(
        (game, index) => index > 0 && game.initialLayout === state.games[index - 1].initialLayout,
      ),
    ).toBe(true);
    for (const game of state.games) {
      expect(game.actions).toHaveLength(4);
      expect(game.familyId).toBe(openingFamilyId(game.initialState, game.actions, game.rules));
      let position = game.initialState;
      for (const action of game.actions) {
        const result = engine.applyAction(position, action, game.rules);
        expect(result.ok).toBe(true);
        position = result.state;
      }
      expect(position.outcome).toBeNull();
    }
    const book = JSON.parse(await readFile(join(config.directory, 'openings.json'), 'utf8'));
    expect(book).toMatchObject({
      format: 'hex-arena-openings-v1',
      role: 'confirmation',
      sourceRole: 'confirmation',
      confirmatory: true,
    });
    expect(book.distribution.independentLayoutAndHpDraws).toBe(true);
    await expect(readFile(join(config.directory, 'trajectories.jsonl'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('uses a separate deterministic random stream and rejects excluded opening families', async () => {
    const config = await options('confirmation');
    const first = freshOpening(config, 0, modules);
    expect(freshOpening(config, 0, modules).familyId).toBe(first.familyId);
    const replacement = freshOpening(config, 0, modules, new Set([first.familyId]));
    expect(replacement.familyId).not.toBe(first.familyId);
    expect(replacement.rejectedDraws).toBeGreaterThan(0);
    expect(freshOpening({ ...config, role: 'development' }, 0, modules).familyId).not.toBe(
      first.familyId,
    );
  });

  it('resumes a checkpoint without replaying completed games and saves each four played plies', async () => {
    const config = { ...(await options('development')), 'max-plies': 8 };
    let calls = 0;
    const search = vi.fn(async (position, searchOptions) => {
      calls += 1;
      if (calls === 13) {
        const checkpoint = JSON.parse(
          await readFile(join(config.directory, 'progress.json'), 'utf8'),
        );
        expect(checkpoint.games).toHaveLength(1);
        expect(checkpoint.inProgress.actions).toHaveLength(8);
        throw new Error('Simulated interruption');
      }
      return classic(position, searchOptions);
    });
    await expect(runFreshTrajectories(config, { ...dependencies, search })).rejects.toThrow(
      /Simulated interruption/,
    );
    const checkpoint = JSON.parse(await readFile(join(config.directory, 'progress.json'), 'utf8'));
    expect(checkpoint.status).toBe('failed');
    expect(checkpoint.games).toHaveLength(1);
    const continuation = vi.fn(classic);
    const resumed = await runFreshTrajectories(
      { ...config, resume: true },
      { ...dependencies, search: continuation },
    );
    expect(resumed.status).toBe('complete');
    expect(resumed.games).toHaveLength(2);
    expect(continuation).toHaveBeenCalledTimes(4);
    expect(resumed.searches).toBe(16);
    expect(
      resumed.games.every((game) => game.outcome === null && game.termination === 'max-plies'),
    ).toBe(true);
    const rows = (await readFile(join(config.directory, 'trajectories.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    expect(rows[0]).toMatchObject({ sourceRole: 'development', teacher: { neural: false } });
    expect(rows.filter((row) => row.kind === 'game')).toHaveLength(2);
  });

  it('does not allow role or protocol changes in an existing directory', async () => {
    const config = await options('confirmation');
    await runFreshTrajectories(config, dependencies);
    await expect(
      runFreshTrajectories({ ...config, role: 'development', resume: true }, dependencies),
    ).rejects.toThrow(/rol, código, configuración/);
    await expect(
      runFreshTrajectories({ ...config, seed: 17, resume: true }, dependencies),
    ).rejects.toThrow(/rol, código, configuración/);
    await expect(
      runFreshTrajectories(
        { ...config, 'reference-root': join(config.directory, 'other-root'), resume: true },
        dependencies,
      ),
    ).rejects.toThrow(/rol, código, configuración/);
    await expect(readFile(join(config.directory, 'trajectories.jsonl'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('validates exclusion manifests on resume and never overwrites edited output', async () => {
    const config = await options('confirmation');
    const manifest = join(config.directory, 'excluded.json');
    await writeFile(manifest, JSON.stringify({ familyIds: ['known-development-family'] }));
    config['exclude-manifest'] = manifest;
    await runFreshTrajectories(config, dependencies);
    await writeFile(manifest, JSON.stringify({ familyIds: ['different-family'] }));
    await expect(runFreshTrajectories({ ...config, resume: true }, dependencies)).rejects.toThrow(
      /exclusiones/,
    );
    await writeFile(manifest, JSON.stringify({ familyIds: ['known-development-family'] }));
    const output = join(config.directory, 'openings.json');
    await writeFile(output, 'manual-work');
    await expect(runFreshTrajectories({ ...config, resume: true }, dependencies)).rejects.toThrow(
      /modificada/,
    );
    expect(await readFile(output, 'utf8')).toBe('manual-work');
  });
});
