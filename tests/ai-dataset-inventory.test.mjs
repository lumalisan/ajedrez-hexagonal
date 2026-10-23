import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import * as engine from '../src/engine';
import * as neural from '../src/ai-neural';
import {
  buildDatasetInventory,
  inventoryInputs,
  inventoryOptions,
} from '../scripts/ai/dataset-inventory.mjs';
import { parseResearchInput } from '../scripts/ai/research-data.mjs';

const modules = { engine, neural };
const rules = { ...engine.DEFAULT_ACTION_RESOLUTION_RULES };
const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'hex-inventory-'));
  directories.push(path);
  return path;
}

function game(count = 8) {
  const initialState = engine.createInitialState();
  const actions = [];
  let state = initialState;
  for (let index = 0; index < count && !state.outcome; index += 1) {
    const action = engine.getAllLegalActions(state)[index];
    actions.push(action);
    state = engine.applyAction(state, action, rules).state;
  }
  return { kind: 'game', initialState, actions, rules };
}

function jsonl(games, extraHeader = {}, samples = []) {
  return (
    [
      { kind: 'metadata', format: 'hexagonal-neural-dataset', version: 1, rules, ...extraHeader },
      ...games,
      ...samples,
    ]
      .map(JSON.stringify)
      .join('\n') + '\n'
  );
}

function file(path, role) {
  return { path, role };
}

describe('explicit dataset inventory', () => {
  it('requires explicit inputs and walks only selected directories without frozen runtimes', async () => {
    expect(() => inventoryOptions(['--output', 'report.json'])).toThrow(/exactamente/);
    const path = await directory();
    await mkdir(join(path, 'selected/runtime'), { recursive: true });
    await writeFile(join(path, 'selected/games.jsonl'), jsonl([game()]));
    await writeFile(join(path, 'selected/runtime/private.json'), '{}');
    await writeFile(join(path, 'unselected.json'), '{}');
    const files = await inventoryInputs({ inputs: join(path, 'selected') });
    expect(files.map((entry) => entry.path)).toEqual([join(path, 'selected/games.jsonl')]);
  });

  it('deduplicates trajectories while retaining legal positions from obsolete teacher labels', async () => {
    const path = await directory();
    const first = join(path, 'old.jsonl');
    const duplicate = join(path, 'copied.jsonl');
    const trajectory = { ...game(), openingPlies: 4 };
    const sample = { kind: 'sample', gameId: 'old', features: [1], teacher: 1 };
    await writeFile(first, jsonl([trajectory], { evaluationVersion: 'old-v1' }, [sample]));
    await writeFile(duplicate, jsonl([{ ...trajectory, gameId: 'renamed-copy' }]));
    const report = await buildDatasetInventory(
      {},
      { modules, files: [file(first), file(duplicate)], sourceHashes: {} },
    );
    expect(report.summary.development.games).toBe(1);
    expect(report.summary.development.positions).toBe(8);
    expect(report.files[0].labels).toBe('obsolete-objective-or-evaluation');
    expect(report.files[0].suitability).toBe('legal-trajectories-for-reanalysis');
    expect(report.games[0].sources).toHaveLength(2);
  });

  it('keeps arenas and every overlapping lineage out of development extraction', async () => {
    const path = await directory();
    const development = join(path, 'development.jsonl');
    const reserved = join(path, 'arena.json');
    const extract = join(path, 'extracted.jsonl');
    const first = { ...game(6), familyId: 'family-a' };
    const variant = { ...game(8), familyId: 'family-a' };
    const separate = { ...game(10), familyId: 'family-c' };
    await writeFile(development, jsonl([first, separate]));
    await writeFile(
      reserved,
      JSON.stringify({ format: 'hexagonal-neural-arena', version: 1, rules, games: [variant] }),
    );
    const report = await buildDatasetInventory(
      { extract },
      { modules, files: [file(development), file(reserved)], sourceHashes: {} },
    );
    expect(report.summary.development.games).toBe(1);
    expect(report.summary.reserved.games).toBe(2);
    const rows = (await readFile(extract, 'utf8')).trim().split('\n').map(JSON.parse);
    const extracted = rows.filter((row) => row.kind === 'game');
    expect(extracted.map((row) => row.familyId)).toEqual(['family-c']);
    expect(rows.some((row) => row.kind === 'sample')).toBe(false);
    expect(rows[0].sources.map((source) => source.path)).toEqual([development]);
    expect(parseResearchInput(await readFile(extract, 'utf8'))[0].familyId).toBe('family-c');
  });

  it('does not inherit opening metadata for unrelated replays from a concatenated header', async () => {
    const path = await directory();
    const source = join(path, 'mixed.jsonl');
    await writeFile(source, jsonl([game(6), game(8)], { settings: { 'opening-plies': 4 } }));
    const report = await buildDatasetInventory(
      {},
      { modules, files: [file(source)], sourceHashes: {} },
    );
    expect(report.summary.development.families).toBe(2);
    expect(report.games.every((entry) => entry.familyMethod === 'unknown-lineage')).toBe(true);
    expect(report.games.every((entry) => entry.openingPlies === null)).toBe(true);
  });

  it('groups an actual complete recorded opening without treating mirrored outcomes as labels', async () => {
    const path = await directory();
    const source = join(path, 'games.jsonl');
    await writeFile(
      source,
      jsonl([
        { ...game(6), openingPlies: 4, outcome: { type: 'win', winner: 0, reason: 'timeout' } },
        { ...game(8), openingPlies: 4 },
      ]),
    );
    const report = await buildDatasetInventory(
      {},
      { modules, files: [file(source)], sourceHashes: {} },
    );
    expect(report.summary.development.games).toBe(2);
    expect(report.summary.development.families).toBe(1);
    expect(report.summary.development.trajectoriesWithBoardOutcome).toBe(0);
    expect(report.summary.development.outcomes).toEqual({ unfinished: 2 });
  });

  it('rejects illegal actions and reports labels without original trajectories separately', async () => {
    const path = await directory();
    const invalid = join(path, 'invalid.jsonl');
    const samples = join(path, 'labels.jsonl');
    const trajectory = game();
    trajectory.actions[0] = { kind: 'rotate', pieceId: 'missing', facing: 0 };
    await writeFile(invalid, jsonl([trajectory]));
    await writeFile(samples, jsonl([], {}, [{ kind: 'sample', features: [1], teacher: 0.5 }]));
    const report = await buildDatasetInventory(
      {},
      { modules, files: [file(invalid), file(samples)], sourceHashes: {} },
    );
    expect(report.files[0].invalidGames[0].error).toMatch(/ilegal/);
    expect(report.files[1].status).toBe('labels-only-no-trajectory');
    expect(report.summary.development.games).toBe(0);
    expect(report.summary.labelsOnlySources).toBe(1);
  });

  it('combines separate explicit development and reserved manifests without scanning siblings', async () => {
    const path = await directory();
    await writeFile(join(path, 'development.jsonl'), jsonl([game()]));
    await writeFile(join(path, 'reserved.json'), '{}');
    await writeFile(join(path, 'unselected.json'), '{}');
    await writeFile(
      join(path, 'development-manifest.json'),
      JSON.stringify({ inputs: [{ path: 'development.jsonl', role: 'development' }] }),
    );
    await writeFile(
      join(path, 'reserved-manifest.json'),
      JSON.stringify({ inputs: [{ path: 'reserved.json' }] }),
    );
    const files = await inventoryInputs({
      manifest: join(path, 'development-manifest.json'),
      'reserved-manifest': join(path, 'reserved-manifest.json'),
    });
    expect(files).toHaveLength(2);
    expect(files.map((entry) => entry.role).sort()).toEqual(['development', 'reserved']);
  });
});
