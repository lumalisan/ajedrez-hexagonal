import { describe, expect, it, vi } from 'vitest';
import { searchMachineActionWithMetadata } from '../src/ai';
import { applyAction, createGameState, getAllLegalActions } from '../src/engine';
import type { GameState } from '../src/types';

function position() {
  return createGameState([
    { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
    { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
    { id: 'launcher', type: 'long', owner: 0, position: { q: 0, r: -2 } },
  ]);
}

describe('learned search evaluator', () => {
  function fortressPressure(carrierQ: number) {
    return createGameState([
      { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 4 }, hp: 2 },
      { id: 'tank', type: 'medium', owner: 0, position: { q: 0, r: 2 }, cannon: 2 },
      { id: 'shield', type: 'antiAir', owner: 1, position: { q: 1, r: 1 } },
      {
        id: 'capturer',
        type: 'capturer',
        owner: 1,
        position: { q: carrierQ, r: carrierQ === 2 ? 1 : 2 },
      },
    ]);
  }

  it('extends a first-HP threat into a real forced win through every legal quiet defense', () => {
    const state = fortressPressure(2);
    const result = searchMachineActionWithMetadata(state, {
      depth: 1,
      budgetMs: 2000,
      searchProfile: 'pvs-threats',
    });
    expect(result.metadata.completedDepth).toBe(1);
    expect(result.metadata.score).toBeGreaterThan(900_000);
    if (!result.action) throw new Error('Missing attack');
    const attack = applyAction(state, result.action).state;
    const defenses = getAllLegalActions(attack);
    expect(defenses.length).toBeGreaterThan(0);
    for (const defense of defenses) {
      const defended = applyAction(attack, defense).state;
      const firstHit = applyAction(defended, { kind: 'shoot', pieceId: 'tank', targetId: 'f1' });
      expect(firstHit.ok).toBe(true);
      const replies = getAllLegalActions(firstHit.state);
      expect(replies.length).toBeGreaterThan(0);
      for (const reply of replies) {
        const response = applyAction(firstHit.state, reply).state;
        const lastHit = applyAction(response, { kind: 'shoot', pieceId: 'tank', targetId: 'f1' });
        expect(lastHit.ok).toBe(true);
        expect(lastHit.state.outcome).toMatchObject({ type: 'win', winner: 0 });
      }
    }
  });

  it('does not call a first-HP threat mate when a quiet approach allows a countercapture', () => {
    const state = fortressPressure(1);
    const result = searchMachineActionWithMetadata(state, {
      depth: 1,
      budgetMs: 2000,
      searchProfile: 'pvs-threats',
    });
    expect(result.metadata.score).toBeGreaterThan(5000);
    expect(result.metadata.score).toBeLessThan(900_000);
    if (!result.action) throw new Error('Missing attack');
    let after = applyAction(state, result.action).state;
    after = applyAction(after, { kind: 'move', pieceId: 'capturer', to: { q: 0, r: 2 } }).state;
    after = applyAction(after, { kind: 'shoot', pieceId: 'tank', targetId: 'f1' }).state;
    const capture = applyAction(after, { kind: 'convert', pieceId: 'capturer', targetId: 'tank' });
    expect(capture.ok).toBe(true);
    expect(capture.state.pieces.find((piece) => piece.id === 'tank')?.owner).toBe(1);
    expect(capture.state.outcome).toBeNull();
  });
  it('PVS reproduces an exhaustive two-ply value, including fractional bounds', () => {
    const state = createGameState([
      { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
      { id: 's0', type: 'soldier', owner: 0, position: { q: -3, r: 0 }, facing: 0 },
      { id: 's1', type: 'soldier', owner: 1, position: { q: 3, r: 0 }, facing: 3 },
    ]);
    const value = (position: GameState): number =>
      position.pieces.reduce(
        (total, piece) =>
          total +
          (piece.owner === 0 ? 1 : -1) *
            (piece.position.r * 0.137 +
              piece.position.q * 0.031 +
              (piece.type === 'soldier' ? piece.facing * 0.00000003 : 0)),
        0,
      );
    function exhaustive(position: GameState, depth: number): number {
      if (!depth) return value(position);
      const scores = getAllLegalActions(position).map((action) =>
        exhaustive(applyAction(position, action).state, depth - 1),
      );
      return position.activePlayer === 0 ? Math.max(...scores) : Math.min(...scores);
    }
    const expected = exhaustive(state, 2);
    for (const searchProfile of ['classic', 'pvs-history', 'pvs-threats'] as const) {
      const result = searchMachineActionWithMetadata(state, {
        depth: 2,
        budgetMs: 1000,
        evaluate: value,
        searchProfile,
      });
      expect(result.metadata.completedDepth).toBe(2);
      expect(result.metadata.score).toBeCloseTo(expected, 12);
      if (searchProfile !== 'classic' && result.action) {
        expect(exhaustive(applyAction(state, result.action).state, 1)).toBeCloseTo(expected, 12);
      }
    }
  });

  it('receives the root perspective and exact match rules without mutating the position', () => {
    const state = position();
    const before = structuredClone(state);
    const rules = { repetition: null, noProgressPlyLimit: null };
    const evaluate = vi.fn(() => 37);
    const result = searchMachineActionWithMetadata(state, {
      depth: 1,
      budgetMs: 1_000,
      evaluate,
      resolutionRules: rules,
    });
    expect(evaluate).toHaveBeenCalledWith(expect.any(Object), 0, rules);
    expect(getAllLegalActions(state)).toContainEqual(result.action);
    expect(state).toEqual(before);
    expect(result.metadata.completedDepth).toBe(1);
  });

  it.each(['classic', 'pvs-history', 'pvs-threats'] as const)(
    'keeps proven victories with the %s profile',
    (searchProfile) => {
      const state = createGameState([
        { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 3 }, hp: 1 },
        { id: 'launcher', type: 'long', owner: 0, position: { q: 0, r: 0 } },
      ]);
      const evaluate = vi.fn<(state: GameState) => number>(() => -9_999);
      const result = searchMachineActionWithMetadata(state, {
        depth: 1,
        budgetMs: 1_000,
        evaluate,
        searchProfile,
      });
      expect(result.action).not.toBeNull();
      if (!result.action) throw new Error('Missing winning action');
      expect(applyAction(state, result.action).state.outcome).toMatchObject({
        type: 'win',
        winner: 0,
      });
      expect(result.metadata.score).toBeGreaterThan(900_000);
      expect(evaluate.mock.calls.every(([evaluated]) => !evaluated.outcome)).toBe(true);
    },
  );

  it.each([NaN, Infinity, -Infinity, 1_000_000])('rejects invalid estimates: %s', (value) => {
    expect(() =>
      searchMachineActionWithMetadata(position(), {
        depth: 1,
        budgetMs: 1_000,
        evaluate: () => value,
      }),
    ).toThrow('evaluación');
  });
});
