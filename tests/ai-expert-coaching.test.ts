import { describe, expect, it, vi } from 'vitest';
import {
  chooseMachineAction,
  evaluateClassicState,
  searchMachineActionWithMetadata,
} from '../src/ai';
import { airplanePositionScore } from '../src/ai-airplane';
import {
  applyAction,
  createGameState,
  getAllLegalActions,
  getPreviewActionsForPiece,
} from '../src/engine';
import { hexDistance } from '../src/hex';
import type { GameState, Piece } from '../src/types';

function forts(): Piece[] {
  return [
    { id: 'home', type: 'fortress', owner: 0, position: { q: -5, r: 5 }, hp: 2 },
    { id: 'enemy', type: 'fortress', owner: 1, position: { q: 5, r: -5 }, hp: 2 },
  ];
}

function expert(state: GameState, seed = 101) {
  const snapshot = structuredClone(state);
  const result = searchMachineActionWithMetadata(state, {
    difficulty: 'expert',
    personality: 'balanced',
    depth: 1,
    budgetMs: 1000,
    seed,
  });
  expect(result.action).not.toBeNull();
  expect(getAllLegalActions(state)).toContainEqual(result.action);
  expect(state).toEqual(snapshot);
  const next = applyAction(state, result.action!);
  expect(next.ok).toBe(true);
  return { ...result, next: next.state };
}

describe('Expert coaching', () => {
  it.each(['medium', 'capturer'] as const)('advances its %s when the front is clear', (type) => {
    const actor: Piece =
      type === 'medium'
        ? { id: 'vanguard', type, owner: 0, position: { q: 0, r: 2 }, cannon: 0 }
        : { id: 'vanguard', type, owner: 0, position: { q: 0, r: 2 } };
    const state = createGameState([
      { id: 'home', type: 'fortress', owner: 0, position: { q: 0, r: 5 }, hp: 2 },
      { id: 'enemy', type: 'fortress', owner: 1, position: { q: 0, r: -5 }, hp: 2 },
      actor,
      { id: 'guard', type: 'soldier', owner: 1, position: { q: 4, r: -4 }, facing: 3 },
    ]);
    const moved = expert(state).next.pieces.find((p) => p.id === actor.id)!;
    expect(hexDistance(moved.position, { q: 0, r: -5 })).toBeLessThan(7);
  });

  it.each(['medium', 'long', 'drone', 'airplane'] as const)(
    'retains its Embestidor instead of trading it for an isolated %s',
    (type) => {
      const target: Piece =
        type === 'medium'
          ? { id: 'valuable', type, owner: 1, position: { q: 0, r: -2 }, cannon: 3 }
          : type === 'airplane'
            ? { id: 'valuable', type, owner: 1, position: { q: 0, r: -2 }, facing: 3 }
            : { id: 'valuable', type, owner: 1, position: { q: 0, r: -2 } };
      const state = createGameState([
        ...forts(),
        { id: 'fast', type: 'fast', owner: 0, position: { q: 0, r: 0 } },
        { id: 'tank', type: 'medium', owner: 0, position: { q: -3, r: 3 }, cannon: 0 },
        target,
      ]);
      expect(expert(state).next.pieces.find((p) => p.id === 'fast')).toMatchObject({
        type: 'fast',
        owner: 0,
      });
    },
  );

  it.each([2, 3] as const)(
    'does not spend its Embestidor on an unfinished %s-HP Fortress',
    (hp) => {
      const state = createGameState([
        { id: 'home', type: 'fortress', owner: 0, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'enemy', type: 'fortress', owner: 1, position: { q: 0, r: -5 }, hp },
        { id: 'fast', type: 'fast', owner: 0, position: { q: 0, r: -2 } },
        { id: 'tank', type: 'medium', owner: 0, position: { q: -2, r: 3 }, cannon: 0 },
        { id: 'guard', type: 'soldier', owner: 1, position: { q: 4, r: -4 }, facing: 3 },
      ]);
      const fallback = chooseMachineAction(state, { difficulty: 'expert', seed: 101 });
      expect(
        applyAction(state, fallback!).state.pieces.some(
          (p) => p.id === 'fast' && p.type === 'fast',
        ),
      ).toBe(true);
      expect(expert(state).next.pieces.find((p) => p.id === 'fast')).toMatchObject({
        type: 'fast',
      });
    },
  );

  it.each([11, 47, 101])(
    'sacrifices the Embestidor when its hit actually wins (seed %s)',
    (seed) => {
      const state = createGameState([
        { id: 'home', type: 'fortress', owner: 0, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'enemy', type: 'fortress', owner: 1, position: { q: 0, r: -5 }, hp: 1 },
        { id: 'fast', type: 'fast', owner: 0, position: { q: 0, r: -2 } },
        { id: 'guard', type: 'soldier', owner: 1, position: { q: 4, r: -4 }, facing: 3 },
      ]);
      expect(expert(state, seed).next.outcome).toMatchObject({ type: 'win', winner: 0 });
    },
  );

  it('develops a loaded launcher onto its firing ring', () => {
    const state = createGameState([
      { id: 'home', type: 'fortress', owner: 0, position: { q: 0, r: 5 }, hp: 2 },
      { id: 'enemy', type: 'fortress', owner: 1, position: { q: 0, r: -5 }, hp: 2 },
      { id: 'launcher', type: 'long', owner: 0, position: { q: 0, r: 4 } },
      { id: 'target', type: 'capturer', owner: 1, position: { q: 0, r: 0 } },
    ]);
    const result = expert(state);
    const launcher = result.next.pieces.find((p) => p.id === 'launcher')!;
    expect(launcher.type).toBe('long');
    expect(hexDistance(launcher.position, { q: 0, r: 0 })).toBe(3);
    expect(getPreviewActionsForPiece(result.next, 'launcher')).toContainEqual({
      kind: 'shoot',
      pieceId: 'launcher',
      targetId: 'target',
    });
  });

  it.each(['balanced', 'guardian'] as const)(
    'develops the %s battery instead of keeping it home without a threat',
    (personality) => {
      const state = createGameState(
        [
          { id: 'home', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
          { id: 'enemy', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
          { id: 'launcher', type: 'long', owner: 1, position: { q: 0, r: 2 } },
        ],
        1,
      );
      const action = chooseMachineAction(state, { difficulty: 'expert', personality, seed: 1 });
      const next = applyAction(state, action!).state.pieces.find((p) => p.id === 'launcher')!;
      expect(hexDistance(next.position, { q: 0, r: -5 })).toBeLessThan(7);
    },
  );

  it('adds flank support to Expert flight evaluation without inventing a shield or blocking flight', () => {
    const plane: Extract<Piece, { type: 'airplane' }> = {
      id: 'plane',
      type: 'airplane',
      owner: 0,
      position: { q: 0, r: 0 },
      facing: 0,
    };
    const clear = createGameState([...forts(), plane]);
    const supported = createGameState([
      ...forts(),
      plane,
      { id: 'escort', type: 'medium', owner: 0, position: { q: 1, r: 0 }, cannon: 0 },
    ]);
    expect(getPreviewActionsForPiece(supported, plane.id)).toEqual(
      getPreviewActionsForPiece(clear, plane.id),
    );
    expect(airplanePositionScore(supported, plane)).toBe(airplanePositionScore(clear, plane));
    expect(airplanePositionScore(supported, plane, true)).toBeGreaterThan(
      airplanePositionScore(clear, plane, true),
    );
  });

  it('preserves the calibrated neural baseline and explicit evaluator values', () => {
    const state = createGameState([
      { id: 'home', type: 'fortress', owner: 0, position: { q: 0, r: 5 }, hp: 2 },
      { id: 'enemy', type: 'fortress', owner: 1, position: { q: 0, r: -5 }, hp: 2 },
      { id: 'fast', type: 'fast', owner: 0, position: { q: 0, r: 0 } },
    ]);
    expect(evaluateClassicState(state, 0)).toBe(890);
    expect(evaluateClassicState(state, 0, 'balanced', true)).toBeGreaterThan(890);
    const evaluate = vi.fn(() => 13);
    const result = searchMachineActionWithMetadata(state, {
      difficulty: 'expert',
      depth: 1,
      budgetMs: 1000,
      evaluate,
      rangedPlay: false,
      seed: 101,
    });
    expect(evaluate).toHaveBeenCalled();
    expect(result.metadata.score).toBe(13);
    expect(evaluateClassicState(state, 0)).toBe(890);
  });
});
