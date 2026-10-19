import { describe, expect, it } from 'vitest';

import {
  EXPERT_BUDGET_MS,
  EXPERT_DEPTH,
  addSearchMetrics,
  applySearchAction,
  commonArguments,
  createOpening,
  deriveSeed,
  describeSearchMetrics,
  newSearchMetrics,
  normalizedTeacher,
  outcomeForPerspective,
  parseArguments,
  seededRandom,
  summarizeArena,
  validateSparseFeatures,
} from '../scripts/ai/shared.mjs';
import { encodeNeuralFeatures, NEURAL_INPUT_SIZE } from '../src/ai-neural';
import * as engine from '../src/engine';
import * as setup from '../src/setup';

describe('neural experiment arguments', () => {
  it('uses the actual Expert time/depth by default in the arena', () => {
    const options = parseArguments([], commonArguments);
    expect(options['budget-ms']).toBe(EXPERT_BUDGET_MS);
    expect(options.depth).toBe(EXPERT_DEPTH);
    expect(EXPERT_BUDGET_MS).toBe(15_000);
    expect(EXPERT_DEPTH).toBe(9);
  });

  it('supports explicit reduced budgets and rejects silent CLI mistakes', () => {
    const options = parseArguments(
      ['--budget-ms=60', '--depth', '2', '--seed', '0'],
      commonArguments,
    );
    expect(options['budget-ms']).toBe(60);
    expect(options.depth).toBe(2);
    expect(options.seed).toBe(0);
    for (const args of [
      ['--budget-ms', '0'],
      ['--budget-ms', 'Infinity'],
      ['--depth', '2.5'],
      ['--seed', '-1'],
      ['--seed', '4294967296'],
      ['--depth', '--seed'],
      ['--unknown', '1'],
      ['--depth', '1', '--depth', '2'],
      ['--help=true'],
      ['unexpected'],
    ]) {
      expect(() => parseArguments(args, commonArguments)).toThrow();
    }
  });

  it('allows help without a required model, while requiring it for execution', () => {
    const definitions = { ...commonArguments, model: { type: 'string' as const, required: true } };
    expect(() => parseArguments([], definitions)).toThrow('obligatoria');
    expect(parseArguments(['--help'], definitions).help).toBe(true);
  });
});

describe('neural training labels', () => {
  it('accepts the actual sparse encoder output rather than expecting a dense vector', () => {
    const state = engine.createGameState(setup.createInitialPieces(2, 3));
    for (const player of [0, 1] as const) {
      const features = encodeNeuralFeatures(state, player);
      expect(features.length).toBeLessThan(NEURAL_INPUT_SIZE);
      expect(() => validateSparseFeatures(features, NEURAL_INPUT_SIZE)).not.toThrow();
    }
    for (const invalid of [[], [0, 0], [-1], [NEURAL_INPUT_SIZE], [Number.NaN], [0.5]]) {
      expect(() => validateSparseFeatures(invalid, NEURAL_INPUT_SIZE)).toThrow();
    }
  });

  it('normalizes the zero-sum teacher without flipping the fixed perspective', () => {
    expect(normalizedTeacher(0)).toBe(0);
    expect(normalizedTeacher(10_000)).toBeCloseTo(Math.tanh(1));
    expect(normalizedTeacher(-7_500)).toBe(-normalizedTeacher(7_500));
    expect(normalizedTeacher(1_000_000)).toBe(1);
    expect(() => normalizedTeacher(Number.NaN)).toThrow();
  });

  it('distinguishes an unfinished game from a real draw, relative to each player', () => {
    expect(outcomeForPerspective(null, 0)).toBeNull();
    expect(outcomeForPerspective(null, 1)).toBeNull();
    const win = { type: 'win' as const, winner: 1 as const, reason: 'fortress' as const };
    expect(outcomeForPerspective(win, 0)).toBe(-1);
    expect(outcomeForPerspective(win, 1)).toBe(1);
    expect(outcomeForPerspective({ type: 'draw', reason: 'repetition' }, 0)).toBe(0);
  });
});

describe('paired arena accounting', () => {
  it('excludes inconclusive games from score and reports uncertainty', () => {
    const summary = summarizeArena([
      { outcome: { type: 'win', winner: 0, reason: 'fortress' }, neuralPlayer: 0 },
      { outcome: { type: 'win', winner: 0, reason: 'fortress' }, neuralPlayer: 1 },
      { outcome: { type: 'draw', reason: 'no-progress' }, neuralPlayer: 1 },
      { outcome: null, neuralPlayer: 0 },
    ]);
    expect(summary).toMatchObject({
      wins: 1,
      draws: 1,
      losses: 1,
      inconclusive: 1,
      completed: 3,
      score: 0.5,
    });
    expect(summary.scoreInterval95?.[0]).toBeLessThan(0.5);
    expect(summary.scoreInterval95?.[1]).toBeGreaterThan(0.5);
    expect(summary.intervalMethod).toContain('correlación');
    expect(summary.interpretation).toContain('no prueban superioridad');
  });

  it('does not claim a score from games that all reached a move limit', () => {
    expect(summarizeArena([{ outcome: null, neuralPlayer: 0 }])).toMatchObject({
      completed: 0,
      inconclusive: 1,
      score: null,
      scoreInterval95: null,
    });
    const unbeaten = summarizeArena([
      { outcome: { type: 'win', winner: 0, reason: 'fortress' }, neuralPlayer: 0 },
    ]);
    expect(unbeaten.score).toBe(1);
    expect(unbeaten.scoreInterval95?.[0]).toBeLessThan(0.5);
    expect(unbeaten.scoreInterval95?.[1]).toBeLessThanOrEqual(1);
  });

  it('retains depth-zero fallbacks and timeouts in search metrics', () => {
    const metrics = newSearchMetrics();
    const metadata = {
      requestedDepth: 9,
      completedDepth: 0,
      nodes: 3,
      elapsedMs: 60,
      timedOut: true,
      score: null,
      candidatesConsidered: 40,
    };
    addSearchMetrics(metrics, metadata);
    addSearchMetrics(metrics, { ...metadata, completedDepth: 2, nodes: 7, elapsedMs: 40 });
    expect(describeSearchMetrics(metrics)).toMatchObject({
      searches: 2,
      nodes: 10,
      averageDepth: 1,
      averageElapsedMs: 50,
      timedOut: 2,
      depthZero: 1,
    });
    expect(describeSearchMetrics(newSearchMetrics()).averageDepth).toBeNull();
  });
});

describe('seeded legal openings and engine adjudication', () => {
  it('replays precisely the same legal opening for both sides of a pair', () => {
    const modules = { engine, setup };
    const options = { seed: 42, index: 0, openingPlies: 8 };
    const first = createOpening(modules, options);
    const repeated = createOpening(modules, options);
    expect(repeated).toEqual(first);
    let state = first.initialState;
    for (const action of first.actions) {
      const result = engine.applyAction(state, action, engine.DEFAULT_ACTION_RESOLUTION_RULES);
      expect(result.ok).toBe(true);
      state = result.state;
    }
    expect(state).toEqual(first.state);
    expect(first.actions).toHaveLength(8);
    const variants = Array.from({ length: 6 }, (_, index) =>
      createOpening(modules, { seed: 42, index, openingPlies: 0 }),
    );
    expect(variants.map(({ initialLayout, fortressHp }) => [initialLayout, fortressHp])).toEqual([
      [3, 1],
      [5, 1],
      [3, 2],
      [5, 2],
      [3, 3],
      [5, 3],
    ]);
    const twoHp = createOpening(modules, { ...options, fortressHp: 2 });
    expect(twoHp.fortressHp).toBe(2);
    expect(
      twoHp.initialState.pieces
        .filter((piece) => piece.type === 'fortress')
        .every((piece) => piece.hp === 2),
    ).toBe(true);
  });

  it('derives deterministic streams without relying on the global random source', () => {
    const first = seededRandom(deriveSeed(42, 3));
    const second = seededRandom(deriveSeed(42, 3));
    expect(Array.from({ length: 8 }, first)).toEqual(Array.from({ length: 8 }, second));
    expect(deriveSeed(42, 3)).not.toBe(deriveSeed(42, 4));
    expect(deriveSeed(4_294_967_295, 10)).toBeGreaterThanOrEqual(0);
  });

  it('uses engine blockade only when neither player has legal orders', () => {
    const state = engine.createGameState([
      { id: 'cyan', type: 'fortress', owner: 0, hp: 2, position: { q: 0, r: -4 } },
      { id: 'amber', type: 'fortress', owner: 1, hp: 2, position: { q: 0, r: 4 } },
    ]);
    const blocked = applySearchAction(
      { engine },
      state,
      null,
      engine.DEFAULT_ACTION_RESOLUTION_RULES,
    );
    expect(blocked.outcome).toEqual({ type: 'draw', reason: 'blockade' });
    expect(state.outcome).toBeNull();
    const canPass = engine.createGameState([
      ...state.pieces,
      { id: 'enemy', type: 'soldier', owner: 1, facing: 0, position: { q: 0, r: 2 } },
    ]);
    expect(() =>
      applySearchAction({ engine }, canPass, null, engine.DEFAULT_ACTION_RESOLUTION_RULES),
    ).toThrow('Pase no resuelto');
  });

  it('rejects null when a legal action is available and delegates valid actions to the engine', () => {
    const state = engine.createGameState(setup.createInitialPieces(2, 3));
    const action = engine.getAllLegalActions(state)[0];
    expect(() =>
      applySearchAction({ engine }, state, null, engine.DEFAULT_ACTION_RESOLUTION_RULES),
    ).toThrow('existen acciones legales');
    expect(
      applySearchAction({ engine }, state, action, engine.DEFAULT_ACTION_RESOLUTION_RULES),
    ).toEqual(engine.applyAction(state, action).state);
  });
});
