import { describe, expect, it } from 'vitest';

import { chooseMachineAction, searchMachineAction } from '../src/ai';
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

  it('advanced search sees a recapture that the recruit overlooks', () => {
    const pieces: Piece[] = [
      { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
      { id: 'machine-fast', type: 'fast', owner: 1, position: { q: 0, r: 0 } },
      {
        id: 'human-bait',
        type: 'soldier',
        owner: 0,
        position: { q: 0, r: -2 },
        facing: 3,
      },
      { id: 'human-capturer', type: 'capturer', owner: 0, position: { q: 1, r: -2 } },
    ];
    const state = createGameState(pieces, 1);
    const recruit = chooseMachineAction(state);
    const advanced = searchMachineAction(state, { depth: 3, budgetMs: 1_000 });

    expect(recruit).toMatchObject({ kind: 'move', pieceId: 'machine-fast', to: { q: 0, r: -2 } });
    expect(advanced).not.toMatchObject({
      kind: 'move',
      pieceId: 'machine-fast',
      to: { q: 0, r: -2 },
    });
    expect(getAllLegalActions(state)).toContainEqual(advanced);
  });

  it('prefers shooting over a kamikaze when both can destroy the same target', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'machine-airplane', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 },
        { id: 'human-fast', type: 'fast', owner: 0, position: { q: 0, r: 2 } },
      ],
      1,
    );

    expect(chooseMachineAction(state)).toMatchObject({
      kind: 'shoot',
      pieceId: 'machine-airplane',
      targetId: 'human-fast',
    });
  });

  it('uses kamikaze for a favorable exchange but rejects it against a Soldier', () => {
    const favorable = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'machine-airplane', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 },
        { id: 'human-fast', type: 'fast', owner: 0, position: { q: 0, r: 1 } },
      ],
      1,
    );
    expect(chooseMachineAction(favorable)).toMatchObject({
      kind: 'move',
      pieceId: 'machine-airplane',
      to: { q: 0, r: 1 },
    });

    const unfavorable = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'machine-airplane', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 },
        { id: 'human-soldier', type: 'soldier', owner: 0, position: { q: 0, r: 1 }, facing: 0 },
      ],
      1,
    );
    expect(chooseMachineAction(unfavorable)).not.toMatchObject({
      kind: 'move',
      pieceId: 'machine-airplane',
      to: { q: 0, r: 1 },
    });
  });

  it('avoids a fake kamikaze stopped by an enemy shield', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'machine-airplane', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 },
        { id: 'human-shield', type: 'antiAir', owner: 0, position: { q: 1, r: 0 } },
        { id: 'human-fast', type: 'fast', owner: 0, position: { q: 0, r: 1 } },
      ],
      1,
    );

    expect(chooseMachineAction(state)).not.toMatchObject({
      kind: 'move',
      pieceId: 'machine-airplane',
      to: { q: 0, r: 1 },
    });
  });

  it('sacrifices the Avión para destruir inmediatamente la Fortaleza', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: 1 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'machine-airplane', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 },
      ],
      1,
    );

    const action = chooseMachineAction(state);
    expect(action).toMatchObject({
      kind: 'move',
      pieceId: 'machine-airplane',
      to: { q: 0, r: 1 },
    });
    const result = action ? applyAction(state, action) : null;
    expect(result?.state.outcome).toEqual({ type: 'win', winner: 1, reason: 'fortress' });
  });
});
