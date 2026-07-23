import { describe, expect, it } from 'vitest';

import { chooseMachineAction } from '../src/ai';
import { applyAction, createGameState, getAllLegalActions } from '../src/engine';
import { stepHex } from '../src/hex';
import type { Piece } from '../src/types';

describe('machine player', () => {
  it('always returns a legal action without mutating the position', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 's1', type: 'soldier', owner: 1, position: { q: 0, r: 2 }, facing: 3 },
      ],
      1,
    );
    const snapshot = JSON.stringify(state);
    const action = chooseMachineAction(state);

    expect(action).not.toBeNull();
    expect(getAllLegalActions(state)).toContainEqual(action);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('prefers an immediate capture over a passive rotation', () => {
    const origin = { q: 0, r: 0 };
    const target = stepHex(origin, 0);
    const pieces: Piece[] = [
      { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
      { id: 'machine-soldier', type: 'soldier', owner: 1, position: origin, facing: 0 },
      { id: 'human-soldier', type: 'soldier', owner: 0, position: target, facing: 3 },
    ];
    const state = createGameState(pieces, 1);
    const action = chooseMachineAction(state);
    const result = action ? applyAction(state, action) : null;

    expect(action?.kind).toBe('move');
    expect(result?.ok).toBe(true);
    expect(result?.state.pieces.some((piece) => piece.id === 'human-soldier')).toBe(false);
  });
});
