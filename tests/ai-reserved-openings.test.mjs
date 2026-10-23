import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as engine from '../src/engine';
import * as neural from '../src/ai-neural';
import { buildDatasetInventory } from '../scripts/ai/dataset-inventory.mjs';
import { buildReservedOpenings } from '../scripts/ai/reserved-openings.mjs';
import { positionFingerprint } from '../scripts/ai/research-data.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const modules = {
  engine,
  neural,
  ai: {
    searchMachineActionWithMetadata() {
      throw new Error('No search allowed');
    },
  },
};
const rules = { repetition: null, noProgressPlyLimit: null, orientationOnlyTurnLimit: null };

function trajectory(length) {
  const initialState = engine.createGameState([
    { id: 'f0', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
    { id: 'f1', type: 'fortress', owner: 1, position: { q: 5, r: 0 }, hp: 2 },
    { id: 'c0', type: 'capturer', owner: 0, position: { q: 0, r: 0 } },
    { id: 'c1', type: 'capturer', owner: 1, position: { q: 2, r: -2 } },
  ]);
  let state = initialState;
  const actions = [];
  for (let index = 0; index < length; index += 1) {
    const action = engine.getAllLegalActions(state).find((candidate) => {
      const after = engine.applyAction(state, candidate, rules).state;
      return !after.outcome && after.pieces.length === initialState.pieces.length;
    });
    actions.push(action);
    state = engine.applyAction(state, action, rules).state;
  }
  return { initialState, actions, rules, openingPlies: 2 };
}

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'hex-reserved-book-'));
  directories.push(path);
  const source = join(path, 'arena.json');
  const inventory = join(path, 'inventory.json');
  await writeFile(
    source,
    JSON.stringify({
      format: 'hexagonal-neural-arena',
      version: 1,
      rules,
      games: [trajectory(6), trajectory(8)],
      model: { secretCandidateMetric: 'must not influence selection' },
    }),
  );
  await buildDatasetInventory(
    { output: inventory },
    {
      modules,
      files: [{ path: source }],
      sourceHashes: {},
    },
  );
  return {
    source,
    path,
    options: { inventory, 'maximum-prefix-plies': 3, 'preferred-units': 10, seed: 23 },
  };
}

describe('historical reserved development opening book', () => {
  it('selects one legal prefix per family without running a model or search', async () => {
    const { options } = await fixture();
    const book = await buildReservedOpenings(options, { modules });
    expect(book.role).toBe('reserved-development');
    expect(book.confirmatory).toBe(false);
    expect(book.coverage.sourceTrajectories).toBe(2);
    expect(book.entries).toHaveLength(1);
    const entry = book.entries[0];
    expect(entry.actions.length).toBeLessThanOrEqual(3);
    expect(entry.nonFortressUnits).toBe(2);
    let state = entry.initialState;
    for (const action of entry.actions) {
      const result = engine.applyAction(state, action, entry.rules);
      expect(result.ok).toBe(true);
      state = result.state;
    }
    expect(state.outcome).toBeNull();
    expect(
      positionFingerprint(
        [0, 1].map((player) => neural.encodeNeuralFeatures(state, player, entry.rules)),
        entry.rules,
      ),
    ).toBe(entry.stateFingerprint);
  });

  it('is reproducible and distinguishes coverage within the prefix from later opportunities', async () => {
    const { options } = await fixture();
    const first = await buildReservedOpenings(options, { modules });
    const second = await buildReservedOpenings(options, { modules });
    expect(first.entries).toEqual(second.entries);
    expect(first.coverage).toMatchObject({
      sourceFamilies: 1,
      selectedFamilies: 1,
      selectedPreferredMaterial: 1,
      selectedEndgames: 1,
      preferredStatesWithinPrefix: 8,
      preferredStatesAnywhere: 14,
      familiesWithPreferredAnywhere: 1,
    });
  });

  it('refuses changed source files rather than silently selecting new positions', async () => {
    const { source, options } = await fixture();
    await writeFile(source, `${await readFile(source, 'utf8')}\n`);
    await expect(buildReservedOpenings(options, { modules })).rejects.toThrow(
      /cambió después del inventario/,
    );
  });

  it('exports six public regressions separately and reports their four related families honestly', async () => {
    const { path, options } = await fixture();
    const regressions = join(path, 'regressions.json');
    await buildReservedOpenings({ ...options, regressions }, { modules });
    const book = JSON.parse(await readFile(regressions, 'utf8'));
    expect(book.role).toBe('public-regression');
    expect(book.confirmatory).toBe(false);
    expect(book.entries).toHaveLength(6);
    expect(new Set(book.entries.map((entry) => entry.familyId)).size).toBe(4);
    expect(
      book.entries.every((entry) => engine.validateState(entry.initialState).length === 0),
    ).toBe(true);
  });
});
