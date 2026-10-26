import { describe, expect, it, vi } from 'vitest';
import * as engine from '../src/engine';
import * as neural from '../src/ai-neural';
import { developmentGames, directRows, temporalTargets } from '../scripts/ai/direct-data.mjs';

const rules = { repetition: null, noProgressPlyLimit: null, orientationOnlyTurnLimit: 5 };
const settings = {
  mode: 'distill',
  gamma: 0.5,
  lambda: 1,
  tdWeight: 1,
  positionsPerGame: 128,
  minimumGap: 1,
  seed: 19,
};

function trajectory(terminal = false) {
  const initialState = engine.createGameState([
    { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
    { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 3 }, hp: 1 },
    { id: 'long', type: 'long', owner: 0, position: { q: 0, r: 0 }, missilesRemaining: 2 },
    { id: 's1', type: 'soldier', owner: 1, position: { q: -4, r: 4 }, facing: 0 },
  ]);
  const action = terminal
    ? { kind: 'shoot', pieceId: 'long', targetId: 'f1' }
    : engine.getAllLegalActions(initialState).find((action) => action.kind === 'move');
  return {
    gameId: 'g1',
    identity: '1234abcdef',
    familyId: 'family1',
    initialState,
    actions: [action],
    rules,
    knownOutcome: { type: 'win', winner: 1, reason: 'fortress-destroyed' },
  };
}

describe('offline direct value targets', () => {
  it('subtracts the versioned material baseline before clipping, even above 10000 points', () => {
    const game = trajectory(true);
    game.initialState.pieces.find((piece) => piece.id === 'f0').hp = 3;
    const modules = { engine, neural, ranged: { evaluateRangedState: () => 0 } };
    const options = {
      ...settings,
      target: 'material-residual-v1',
      residualScale: 4000,
      successorsPerPosition: 4,
    };
    const result = directRows([game], modules, () => 18100, options);
    const originals = result.rows.filter(
      (row) => row.kind === 'sample' && row.gameId === game.gameId,
    );
    expect(originals.map((row) => row.baseline)).toEqual([15400, -15400]);
    expect(originals.map((row) => row.teacherScore)).toEqual([18100, -18100]);
    expect(originals.map((row) => row.teacher)).toEqual([0.675, -0.675]);
    const branches = result.rows.filter(
      (row) => row.kind === 'sample' && row.gameId !== game.gameId,
    );
    expect(branches.length).toBeGreaterThan(0);
    for (const row of branches) {
      expect(row.outcome).toBeNull();
      expect(row.teacher).toBeCloseTo(
        Math.max(-1, Math.min(1, (row.teacherScore - row.baseline) / 4000)),
        12,
      );
    }
    const clipped = directRows([game], modules, () => 24000, {
      ...options,
      successorsPerPosition: 0,
    });
    expect(clipped.rows.filter((row) => row.kind === 'sample').map((row) => row.teacher)).toEqual([
      1, -1,
    ]);
    expect(clipped.counts.clippedResidualPositions).toBe(1);
    expect(() => directRows([game], modules, () => 0, { ...options, mode: 'td' })).toThrow(
      'destilación',
    );
    expect(() => directRows([game], modules, () => 0, { ...options, residualScale: 0 })).toThrow(
      'escala',
    );
  });
  it('rejects confirmation or unspecified inputs before using trajectories', () => {
    for (const sourceRole of ['confirmation', 'reserved', undefined]) {
      expect(() => developmentGames(JSON.stringify({ sourceRole }))).toThrow('sourceRole');
    }
    const text = [
      {
        kind: 'metadata',
        format: 'hexagonal-neural-dataset',
        version: 1,
        sourceRole: 'development',
      },
      { kind: 'game', ...trajectory() },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n');
    expect(developmentGames(text)[0].familyId).toBe('family1');
  });
  it('uses fixed-player TD(0) and TD(1), including the true terminal boundary', () => {
    expect(temporalTargets([0.8, -0.4, 0.6], 1, 0.5, 0)).toEqual([-0.2, 0.5]);
    expect(temporalTargets([0.8, -0.4, 0.6], 1, 0.5, 1)).toEqual([0.25, 0.5]);
    expect(temporalTargets([0.8, -0.4, 0.6], -1, 0.5, 1)).toEqual([-0.25, -0.5]);
    expect(temporalTargets([0.8, -0.4, 0.6], 0, 0.5, 1)).toEqual([0, 0]);
    expect(temporalTargets([0.8, -0.4, 0.6], null, 0.5, 1)).toEqual([0.15, 0.3]);
    const mixed = temporalTargets([0.8, -0.4, 0.6], null, 1, 0.5);
    expect(mixed[0]).toBeCloseTo(0.1, 14);
    expect(mixed[1]).toBe(0.6);
  });

  it('discounts a positive prediction around a cycle without declaring a draw', () => {
    const result = temporalTargets(Array(11).fill(0.4), null, 0.99, 0.7);
    expect(result.every((value) => value > 0 && value < 0.4)).toBe(true);
    expect(result[0]).toBeLessThan(result.at(-1));
  });

  it.each([
    [[0], null, 0.9, 0.7],
    [[0, NaN], null, 0.9, 0.7],
    [[0, 2], null, 0.9, 0.7],
    [[0, 0], undefined, 0.9, 0.7],
    [[0, 0], null, 0, 0.7],
    [[0, 0], null, 1.1, 0.7],
    [[0, 0], null, 0.9, -1],
  ])('rejects invalid TD contracts: %j', (values, outcome, gamma, lambda) => {
    expect(() => temporalTargets(values, outcome, gamma, lambda)).toThrow('TD');
  });

  it('includes ranged value exactly once, pairs perspectives and preserves lineage', () => {
    const game = trajectory();
    const original = JSON.stringify(game);
    const ranged = { evaluateRangedState: vi.fn(() => 100) };
    const evaluate = () => 200;
    const result = directRows([game, game], { engine, neural, ranged }, evaluate, settings);
    const samples = result.rows.filter((row) => row.kind === 'sample');
    expect(result.counts).toEqual({
      games: 1,
      families: 1,
      completed: 0,
      truncated: 1,
      positions: 1,
      expandedPositions: 0,
    });
    expect(samples.map((sample) => sample.teacher)).toEqual([0.03, -0.03]);
    expect(samples.map((sample) => sample.outcome)).toEqual([null, null]);
    expect(samples.every((sample) => sample.familyId === 'family1')).toBe(true);
    expect(samples[0].features).toEqual(
      neural.encodeNeuralFeatures(game.initialState, 0, rules, neural.NEURAL_FEATURE_SCHEMA_V2),
    );
    expect(JSON.stringify(game)).toBe(original);
    evaluate.includesRangedValue = true;
    ranged.evaluateRangedState.mockClear();
    const included = directRows([game], { engine, neural, ranged }, evaluate, settings);
    expect(included.rows.find((row) => row.kind === 'sample').teacher).toBe(0.02);
    expect(ranged.evaluateRangedState).not.toHaveBeenCalled();
  });

  it('uses only engine outcomes and bootstraps truncated trajectories', () => {
    const modules = { engine, neural, ranged: { evaluateRangedState: () => 0 } };
    const evaluate = () => 2000;
    const options = { ...settings, mode: 'td' };
    const cut = directRows([trajectory()], modules, evaluate, options);
    const win = directRows([trajectory(true)], modules, evaluate, options);
    expect(cut.rows.filter((row) => row.kind === 'sample').map((row) => row.teacher)).toEqual([
      0.1, -0.1,
    ]);
    expect(
      cut.rows.filter((row) => row.kind === 'sample').every((row) => row.outcome === null),
    ).toBe(true);
    expect(win.rows.filter((row) => row.kind === 'sample').map((row) => row.teacher)).toEqual([
      0.5, -0.5,
    ]);
    expect(win.rows.filter((row) => row.kind === 'sample').map((row) => row.outcome)).toEqual([
      1, -1,
    ]);
    expect(win.counts.completed).toBe(1);
  });

  it('rejects an illegal trajectory before calling the target model', () => {
    const game = trajectory();
    game.actions.push({ kind: 'shoot', pieceId: 'missing', targetId: 'f1' });
    const evaluate = vi.fn(() => 0);
    expect(() => directRows([game], { engine, neural, ranged: {} }, evaluate, settings)).toThrow(
      'Replay ilegal',
    );
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('keeps alternative legal successors in their source family with unknown outcomes', () => {
    const game = trajectory(true);
    const modules = { engine, neural, ranged: { evaluateRangedState: () => 0 } };
    const options = { ...settings, successorsPerPosition: 4 };
    const result = directRows([game], modules, () => 3000, options);
    expect(result.counts.expandedPositions).toBeGreaterThan(0);
    const branches = result.rows.filter((row) => row.kind === 'game' && row.branchOrigin);
    expect(branches.length).toBe(result.counts.expandedPositions);
    for (const branch of branches) {
      expect(branch.familyId).toBe(game.familyId);
      expect(branch.knownOutcome).toBeNull();
      let state = branch.initialState;
      for (const action of branch.actions) {
        const next = engine.applyAction(state, action, rules);
        expect(next.ok).toBe(true);
        state = next.state;
      }
      expect(state.outcome).toBeNull();
      const samples = result.rows.filter(
        (row) => row.kind === 'sample' && row.gameId === branch.gameId,
      );
      expect(samples.map((row) => row.teacher)).toEqual([0.3, -0.3]);
      expect(samples.every((row) => row.outcome === null)).toBe(true);
      expect(samples[0].features).toEqual(
        neural.encodeNeuralFeatures(state, 0, rules, neural.NEURAL_FEATURE_SCHEMA_V2),
      );
    }
    expect(directRows([game], modules, () => 3000, options)).toEqual(result);
    expect(() => directRows([game], modules, () => 0, { ...options, mode: 'td' })).toThrow('no TD');
  });
});
