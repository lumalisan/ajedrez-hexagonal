import { getPreviewActionsForPiece, isProtectedByPlayer } from './engine';
import { directionBetween, hexDistance, isOnBoard, stepHex } from './hex';
import type { Direction, GameState, Piece } from './types';

type Airplane = Extract<Piece, { type: 'airplane' }>;

/**
 * A plane cannot turn on the spot or reverse: its material value depends on
 * retaining room to manoeuvre. Legal exits come from the engine; runway and
 * heading are positional estimates, never a substitute for legal actions.
 */
export function airplanePositionScore(state: GameState, piece: Airplane): number {
  const enemy = piece.owner === 0 ? 1 : 0;
  const directions = new Set<Direction>();
  let exits = 0;
  let bestRunway = 0;
  for (const action of getPreviewActionsForPiece(state, piece.id)) {
    if (action.kind !== 'move' || action.kamikaze || isProtectedByPlayer(state, action.to, enemy))
      continue;
    const direction = directionBetween(piece.position, action.to);
    if (direction === null) continue;
    directions.add(direction);
    exits += 1;
    bestRunway = Math.max(bestRunway, runwayLength(action.to, direction));
  }

  // An outward-facing plane may look advanced while being effectively trapped.
  // These penalties stay below its material value so tactical gains still win.
  const confinement = directions.size === 0 ? 180 : directions.size === 1 ? 45 : 0;
  return (
    exits * 3 + directions.size * 7 + bestRunway * 3 - confinement + headingScore(state, piece)
  );
}

function runwayLength(position: Piece['position'], facing: Direction): number {
  // Four empty-board cells are enough for this estimate. Occupancy and enemy
  // attacks are evaluated by the legal search, not inferred from this ray.
  let length = 0;
  for (let distance = 1; distance <= 4; distance += 1) {
    if (!isOnBoard(stepHex(position, facing, distance))) break;
    length = distance;
  }
  return length;
}

function headingScore(state: GameState, piece: Airplane): number {
  const ahead = stepHex(piece.position, piece.facing);
  let best = -18;
  let hasTarget = false;
  for (const target of state.pieces) {
    if (target.owner === piece.owner || target.type === 'antiAir') continue;
    const distance = hexDistance(piece.position, target.position);
    if (distance === 0) continue;
    hasTarget = true;
    // Distance reduction estimates useful heading without prescribing a move:
    // a plane still has to choose an actual legal order through the search.
    const progress = distance - hexDistance(ahead, target.position);
    const relevance = target.type === 'fortress' ? 18 : 12;
    best = Math.max(best, progress * relevance);
  }
  return hasTarget ? best : 0;
}
