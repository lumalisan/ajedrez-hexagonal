import { getPreviewActionsForPiece, isProtectedByPlayer, occupancyAt } from './engine';
import { directionBetween, hexDistance, isOnBoard, stepHex } from './hex';
import type { Direction, GameAction, GameState, Piece } from './types';

type Airplane = Extract<Piece, { type: 'airplane' }>;

/**
 * A plane cannot turn on the spot or reverse: its material value depends on
 * retaining room to manoeuvre. Legal exits come from the engine; runway and
 * heading are positional estimates, never a substitute for legal actions.
 */
export function airplanePositionScore(state: GameState, piece: Airplane): number {
  const directions = new Set<Direction>();
  let exits = 0;
  let bestRunway = 0;
  let continuationHeadings = 0;
  for (const action of safeFlights(state, piece)) {
    const direction = directionBetween(piece.position, action.to);
    if (direction === null) continue;
    directions.add(direction);
    exits += 1;
    bestRunway = Math.max(bestRunway, runwayLength(state, piece, action.to, direction));
    // This is a static two-flight mobility estimate, not an enemy reply search.
    // The engine still decides occupancy, headings and available flight orders.
    const moved: Airplane = { ...piece, position: action.to, facing: direction };
    const preview = {
      ...state,
      pieces: state.pieces.map((unit) => (unit.id === piece.id ? moved : unit)),
    };
    const nextHeadings = new Set(
      safeFlights(preview, moved).map((next) => directionBetween(moved.position, next.to)),
    );
    continuationHeadings = Math.max(continuationHeadings, nextHeadings.size);
  }

  // An outward-facing plane may look advanced while being effectively trapped.
  // These penalties stay below its material value so tactical gains still win.
  const confinement = directions.size === 0 ? 300 : directions.size === 1 ? 90 : 0;
  const corridor = runwayLength(state, piece, piece.position, piece.facing);
  return (
    exits * 3 +
    directions.size * 7 +
    bestRunway * 3 +
    corridor * 16 +
    continuationHeadings * 20 -
    (continuationHeadings < 2 ? 80 : 0) -
    confinement +
    headingScore(state, piece)
  );
}

function safeFlights(
  state: GameState,
  piece: Airplane,
): Array<Extract<GameAction, { kind: 'move' }>> {
  const enemy = piece.owner === 0 ? 1 : 0;
  return getPreviewActionsForPiece(state, piece.id).filter(
    (action): action is Extract<GameAction, { kind: 'move' }> => {
      if (action.kind !== 'move' || action.kamikaze) return false;
      const direction = directionBetween(piece.position, action.to);
      if (direction === null) return false;
      for (let step = 1; step <= hexDistance(piece.position, action.to); step += 1) {
        if (isProtectedByPlayer(state, stepHex(piece.position, direction, step), enemy))
          return false;
      }
      return true;
    },
  );
}

function runwayLength(
  state: GameState,
  piece: Airplane,
  position: Piece['position'],
  facing: Direction,
): number {
  let length = 0;
  for (let distance = 1; distance <= 4; distance += 1) {
    const cell = stepHex(position, facing, distance);
    if (!isOnBoard(cell) || isProtectedByPlayer(state, cell, piece.owner === 0 ? 1 : 0)) break;
    const occupied = occupancyAt(state, cell).air;
    if (occupied && occupied.id !== piece.id) break;
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
