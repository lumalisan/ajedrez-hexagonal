import { describe, expect, it } from 'vitest';

import { searchMachineAction } from '../src/ai';
import { airplanePositionScore } from '../src/ai-airplane';
import { applyAction, createGameState, getPreviewActionsForPiece } from '../src/engine';
import { directionAtOffset, directionBetween } from '../src/hex';
import type { Piece } from '../src/types';

type Airplane = Extract<Piece, { type: 'airplane' }>;

function plane(q: number, r: number, facing: Airplane['facing']): Airplane {
  return { id: 'plane', type: 'airplane', owner: 1, position: { q, r }, facing };
}

function position(airplane: Airplane, otherPieces: Piece[] = []) {
  return createGameState(
    [
      { id: 'home', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 3 },
      { id: 'target', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 3 },
      { id: 'guard', type: 'soldier', owner: 0, position: { q: -1, r: -4 }, facing: 3 },
      airplane,
      ...otherPieces,
    ],
    1,
  );
}

describe('airplane flight evaluation', () => {
  it('values inward manoeuvring room above facing out of the same edge hex', () => {
    const inward = plane(5, -2, 5);
    const outward = plane(5, -2, 2);
    expect(airplanePositionScore(position(inward), inward)).toBeGreaterThan(
      airplanePositionScore(position(outward), outward) + 100,
    );
  });

  it('does not count intercepted flights as escapes from a confined position', () => {
    const airplane = plane(4, -1, 2);
    const blocker: Piece = { id: 'blocker', type: 'drone', owner: 1, position: { q: 5, r: -2 } };
    const clear = position(airplane, [blocker]);
    const shielded = position(airplane, [
      blocker,
      { id: 'shield', type: 'antiAir', owner: 0, position: { q: 5, r: 0 } },
    ]);
    const moves = getPreviewActionsForPiece(shielded, airplane.id).filter(
      (action) => action.kind === 'move',
    );
    expect(moves.length).toBeGreaterThan(0);
    expect(
      moves.every((action) => {
        const result = applyAction(shielded, action);
        return result.ok && !result.state.pieces.some((piece) => piece.id === airplane.id);
      }),
    ).toBe(true);
    expect(airplanePositionScore(clear, airplane)).toBeGreaterThan(
      airplanePositionScore(shielded, airplane) + 100,
    );
  });

  it('keeps a useful heading toward targets when both headings have open airspace', () => {
    const forward = plane(0, 0, 0);
    const backward = plane(0, 0, 3);
    expect(airplanePositionScore(position(forward), forward)).toBeGreaterThan(
      airplanePositionScore(position(backward), backward),
    );
  });

  it('evaluates both sides without changing the state or its active player', () => {
    const airplane = plane(2, -2, 0);
    const state = { ...position(airplane), activePlayer: 0 as const };
    const snapshot = JSON.stringify(state);
    expect(airplanePositionScore(state, airplane)).toBe(
      airplanePositionScore(position(airplane), airplane),
    );
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('preserves the evaluation when swapping players and rotating the whole board', () => {
    const airplane = plane(-3, 1, 4);
    const state = position(airplane);
    const rotatedPieces = state.pieces.map((piece): Piece => ({
      ...piece,
      owner: piece.owner === 0 ? 1 : 0,
      position: { q: -piece.position.q, r: -piece.position.r },
      ...('facing' in piece ? { facing: directionAtOffset(piece.facing, 3) } : {}),
    }));
    const rotated = createGameState(rotatedPieces, 0);
    const rotatedPlane = rotated.pieces.find(
      (piece): piece is Airplane => piece.id === airplane.id && piece.type === 'airplane',
    )!;
    expect(airplanePositionScore(rotated, rotatedPlane)).toBe(
      airplanePositionScore(state, airplane),
    );
  });

  it.each([1, 7, 37, 101])(
    'search keeps a way to turn instead of flying into the corner (seed %s)',
    (seed) => {
      const airplane = plane(-4, 0, 4);
      const state = position(airplane);
      const corner = applyAction(state, {
        kind: 'move',
        pieceId: airplane.id,
        to: { q: -5, r: 0 },
      });
      expect(corner.ok).toBe(true);
      expect(getPreviewActionsForPiece(corner.state, airplane.id)).toHaveLength(0);

      const action = searchMachineAction(state, { depth: 1, budgetMs: 1_000, seed });
      expect(action).not.toBeNull();
      const result = applyAction(state, action!);
      expect(result.ok).toBe(true);
      const moved = result.state.pieces.find((piece) => piece.id === airplane.id)!;
      const escapeHeadings = new Set(
        getPreviewActionsForPiece(result.state, airplane.id)
          .filter((candidate) => candidate.kind === 'move' && !candidate.kamikaze)
          .map((candidate) =>
            candidate.kind === 'move' ? directionBetween(moved.position, candidate.to) : null,
          ),
      );
      expect(escapeHeadings.size).toBeGreaterThanOrEqual(2);
    },
  );

  it('continues toward the enemy instead of turning aside just to approach the board centre', () => {
    const airplane = plane(2, 2, 0);
    const state = position(airplane);
    const action = searchMachineAction(state, { depth: 1, budgetMs: 1_000, seed: 37 });
    expect(action).toMatchObject({ kind: 'move', pieceId: airplane.id });
    if (action?.kind !== 'move') throw new Error('Expected a flight');
    expect(directionBetween(airplane.position, action.to)).toBe(airplane.facing);
  });

  it('still chooses a winning kamikaze at the edge instead of preserving flight space', () => {
    const airplane = plane(4, -1, 2);
    const state = position(airplane);
    const fortress = state.pieces.find((piece) => piece.id === 'target')!;
    const winningState = createGameState(
      state.pieces.map((piece) =>
        piece.id === fortress.id
          ? {
              ...fortress,
              type: 'fortress',
              position: { q: 5, r: -1 },
              hp: 1,
            }
          : piece,
      ),
      1,
    );
    const action = searchMachineAction(winningState, { depth: 1, budgetMs: 1_000, seed: 37 });
    expect(action).toMatchObject({ kind: 'move', pieceId: airplane.id, kamikaze: true });
    expect(applyAction(winningState, action!).state.outcome).toMatchObject({
      type: 'win',
      winner: 1,
    });
  });
});
