import { describe, expect, it } from 'vitest';
import {
  createGameState,
  getAllLegalActions,
  getFiringRangeCells,
  getPiece,
  getPreviewActionsForPiece,
} from '../src/engine';
import type { Piece } from '../src/types';

function position() {
  const launcher: Piece = {
    id: 'launcher',
    type: 'long',
    owner: 0,
    position: { q: 0, r: 0 },
    missilesRemaining: 2,
  };
  const guard: Piece = { id: 'guard', type: 'antiAir', owner: 0, position: { q: 1, r: -3 } };
  const target: Piece = {
    id: 'target',
    type: 'soldier',
    owner: 1,
    position: { q: 0, r: -3 },
    facing: 0,
  };
  const state = createGameState([
    { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
    { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
    launcher,
    guard,
    target,
  ]);
  const savedLauncher = getPiece(state, launcher.id);
  const savedGuard = getPiece(state, guard.id);
  const savedTarget = getPiece(state, target.id);
  if (!savedLauncher || !savedGuard || !savedTarget) throw new Error('Missing fixture pieces.');
  return { state, launcher: savedLauncher, guard: savedGuard, target: savedTarget };
}

describe('rules queries after an edited position', () => {
  it('updates firing protection and occupancy when existing pieces change between queries', () => {
    const { state, guard, target } = position();
    const before = structuredClone(state);
    expect(getAllLegalActions(state)).toContainEqual({
      kind: 'shoot',
      pieceId: 'launcher',
      targetId: 'target',
    });
    expect(state).toEqual(before);

    guard.owner = 1;
    expect(getFiringRangeCells(state, 'launcher')).not.toContainEqual(target.position);
    expect(getAllLegalActions(state)).not.toContainEqual({
      kind: 'shoot',
      pieceId: 'launcher',
      targetId: 'target',
    });

    target.position = { q: 0, r: 3 };
    expect(getAllLegalActions(state)).toContainEqual({
      kind: 'shoot',
      pieceId: 'launcher',
      targetId: 'target',
    });
  });

  it('uses a replacement piece even if its ID and the pieces array are reused', () => {
    const { state, launcher } = position();
    getAllLegalActions(state);
    const replacement: Piece = {
      id: launcher.id,
      type: 'soldier',
      owner: 0,
      position: launcher.position,
      facing: 0,
    };
    state.pieces[state.pieces.findIndex((piece) => piece.id === launcher.id)] = replacement;

    expect(getPiece(state, launcher.id)).toBe(replacement);
    expect(getPreviewActionsForPiece(state, launcher.id)).toContainEqual({
      kind: 'rotate',
      pieceId: launcher.id,
      facing: 1,
    });
    expect(
      getAllLegalActions(state).filter((action) => action.pieceId === launcher.id),
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'shoot' })]));
  });
});
