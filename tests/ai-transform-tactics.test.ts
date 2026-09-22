import { describe, expect, it, vi } from 'vitest';

import { searchMachineActionWithMetadata } from '../src/ai';
import { applyAction, createGameState, getAllLegalActions } from '../src/engine';
import type { GameState, Piece } from '../src/types';

const fortresses: Piece[] = [
  { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
  { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
];

function chooseExpert(state: GameState) {
  const result = searchMachineActionWithMetadata(state, {
    depth: 1,
    budgetMs: 2_000,
    difficulty: 'expert',
    seed: 7,
  });
  expect(result.metadata.completedDepth).toBe(1);
  expect(result.action).not.toBeNull();
  expect(getAllLegalActions(state)).toContainEqual(result.action);
  return result.action!;
}

function chooseExpiredExpert(state: GameState) {
  // Give initialization a valid deadline, then expire before the first search
  // iteration: the fallback must still account for immediate tactical losses.
  const clock = vi
    .spyOn(performance, 'now')
    .mockReturnValue(2_000)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0);
  try {
    const result = searchMachineActionWithMetadata(state, {
      depth: 9,
      budgetMs: 1_000,
      difficulty: 'expert',
      seed: 7,
    });
    expect(result.metadata.timedOut).toBe(true);
    expect(result.action).not.toBeNull();
    expect(getAllLegalActions(state)).toContainEqual(result.action);
    return result.action!;
  } finally {
    clock.mockRestore();
  }
}

describe('machine vehicle transformation tactics', () => {
  it('does not fall back to poisoned bait when the search expires before its first iteration', () => {
    const state = createGameState(
      [
        ...fortresses,
        { id: 'machine-fast', type: 'fast', owner: 1, position: { q: 0, r: 0 } },
        { id: 'bait', type: 'soldier', owner: 0, position: { q: 0, r: -2 }, facing: 0 },
        { id: 'vehicle', type: 'long', owner: 0, position: { q: 1, r: -2 }, missilesRemaining: 0 },
      ],
      1,
    );
    expect(chooseExpiredExpert(state)).not.toMatchObject({
      kind: 'move',
      pieceId: 'machine-fast',
      to: { q: 0, r: -2 },
    });
  });

  it('evacuates an airplane threatened by a transformation instead of shooting a Soldier', () => {
    const state = createGameState(
      [
        ...fortresses,
        { id: 'machine-airplane', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 },
        { id: 'bait', type: 'soldier', owner: 0, position: { q: 0, r: 2 }, facing: 0 },
        { id: 'vehicle', type: 'long', owner: 0, position: { q: 1, r: 0 }, missilesRemaining: 0 },
      ],
      1,
    );
    const after = applyAction(state, chooseExpiredExpert(state)).state;
    expect(after.pieces.some((piece) => piece.id === 'machine-airplane')).toBe(true);
    expect(
      getAllLegalActions(after).some(
        (reply) =>
          reply.kind === 'transform' &&
          !applyAction(after, reply).state.pieces.some((piece) => piece.id === 'machine-airplane'),
      ),
    ).toBe(false);
  });

  it('does not trade a loaded launcher for a Soldier after an immediate timeout', () => {
    const state = createGameState(
      [
        ...fortresses,
        { id: 'vehicle', type: 'long', owner: 1, position: { q: 0, r: 0 }, missilesRemaining: 2 },
        { id: 'bait', type: 'soldier', owner: 0, position: { q: 1, r: 0 }, facing: 3 },
      ],
      1,
    );
    expect(chooseExpiredExpert(state).kind).not.toBe('transform');
  });

  it('does not mistake a transformation against the ground layer for the loss of both units', () => {
    const state = createGameState(
      [
        ...fortresses,
        { id: 'machine-airplane', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 },
        { id: 'machine-soldier', type: 'soldier', owner: 1, position: { q: 0, r: 0 }, facing: 5 },
        { id: 'bait', type: 'soldier', owner: 0, position: { q: 0, r: 2 }, facing: 0 },
        { id: 'vehicle', type: 'long', owner: 0, position: { q: 1, r: 0 }, missilesRemaining: 0 },
      ],
      1,
    );
    const action = chooseExpiredExpert(state);
    expect(action).toMatchObject({ kind: 'shoot', pieceId: 'machine-airplane', targetId: 'bait' });
    const after = applyAction(state, action).state;
    const recaptures = getAllLegalActions(after).filter(
      (reply) => reply.kind === 'transform' && reply.to?.q === 0 && reply.to.r === 0,
    );
    expect(recaptures.length).toBeGreaterThan(0);
    for (const reply of recaptures) {
      const result = applyAction(after, reply).state;
      expect(result.pieces.some((piece) => piece.id === 'machine-soldier')).toBe(false);
      expect(result.pieces.some((piece) => piece.id === 'machine-airplane')).toBe(true);
    }
  });

  it.each(['medium', 'long'] as const)(
    'does not take bait that an adjacent %s can recapture by transforming',
    (type) => {
      const vehicle: Piece =
        type === 'medium'
          ? { id: 'vehicle', type, owner: 0, position: { q: 1, r: -2 }, cannon: 0 }
          : { id: 'vehicle', type, owner: 0, position: { q: 1, r: -2 }, missilesRemaining: 0 };
      const state = createGameState(
        [
          ...fortresses,
          { id: 'machine-fast', type: 'fast', owner: 1, position: { q: 0, r: 0 } },
          { id: 'bait', type: 'soldier', owner: 0, position: { q: 0, r: -2 }, facing: 0 },
          vehicle,
        ],
        1,
      );
      const baitAction = getAllLegalActions(state).find(
        (action) => action.kind === 'move' && action.to.q === 0 && action.to.r === -2,
      );
      expect(baitAction).toBeDefined();
      const poisoned = applyAction(state, baitAction!).state;
      expect(
        getAllLegalActions(poisoned).some(
          (reply) =>
            reply.kind === 'transform' &&
            !applyAction(poisoned, reply).state.pieces.some((piece) => piece.id === 'machine-fast'),
        ),
      ).toBe(true);

      expect(chooseExpert(state)).not.toMatchObject({
        kind: 'move',
        pieceId: 'machine-fast',
        to: { q: 0, r: -2 },
      });
    },
  );

  it.each(['medium', 'long'] as const)(
    'uses a %s transformation to destroy an adjacent airplane outside its firing range',
    (type) => {
      const vehicle: Piece =
        type === 'medium'
          ? { id: 'vehicle', type, owner: 1, position: { q: 0, r: 0 }, cannon: 0 }
          : { id: 'vehicle', type, owner: 1, position: { q: 0, r: 0 }, missilesRemaining: 0 };
      const state = createGameState(
        [
          ...fortresses,
          vehicle,
          { id: 'airplane', type: 'airplane', owner: 0, position: { q: 1, r: 0 }, facing: 0 },
          { id: 'soldier', type: 'soldier', owner: 0, position: { q: -4, r: 0 }, facing: 0 },
        ],
        1,
      );
      expect(getAllLegalActions(state).some((action) => action.kind === 'shoot')).toBe(false);

      const action = chooseExpert(state);
      expect(action).toMatchObject({
        kind: 'transform',
        pieceId: 'vehicle',
        attackAboveId: 'airplane',
      });
      const result = applyAction(state, action);
      expect(result.state.pieces.some((piece) => piece.id === 'airplane')).toBe(false);
      expect(result.state.pieces.find((piece) => piece.id === 'vehicle')).toMatchObject({
        type: 'soldier',
        owner: 1,
      });
    },
  );
});
