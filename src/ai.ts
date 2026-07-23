import { applyAction, getAllLegalActions, getPiece } from './engine';
import { hexDistance } from './hex';
import type { GameAction, GameState, PieceType, Player } from './types';

const PIECE_VALUE: Record<PieceType, number> = {
  soldier: 18,
  capturer: 28,
  medium: 34,
  long: 38,
  fast: 32,
  drone: 26,
  antiAir: 31,
  fortress: 500,
};

/** Selects a legal move using a deterministic, lightweight one-ply evaluation. */
export function chooseMachineAction(state: GameState): GameAction | null {
  const actions = getAllLegalActions(state);
  if (actions.length === 0) return null;

  let best = actions[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const action of actions) {
    const result = applyAction(state, action);
    if (!result.ok) continue;
    const score =
      evaluateState(result.state, state.activePlayer) +
      tacticalBonus(state, result.state, action) +
      stableActionBias(action);
    if (score > bestScore) {
      best = action;
      bestScore = score;
    }
  }
  return best;
}

function evaluateState(state: GameState, player: Player): number {
  if (state.outcome?.type === 'win')
    return state.outcome.winner === player ? 1_000_000 : -1_000_000;
  if (state.outcome?.type === 'draw') return 0;

  const enemy = player === 0 ? 1 : 0;
  const material = state.pieces.reduce((score, piece) => {
    const value = PIECE_VALUE[piece.type] + (piece.type === 'fortress' ? piece.hp * 220 : 0);
    return score + (piece.owner === player ? value : -value);
  }, 0);
  const enemyFortress = state.pieces.find(
    (piece) => piece.type === 'fortress' && piece.owner === enemy,
  );
  const pressure = enemyFortress
    ? state.pieces
        .filter((piece) => piece.owner === player && piece.type !== 'fortress')
        .reduce(
          (score, piece) =>
            score + Math.max(0, 7 - hexDistance(piece.position, enemyFortress.position)),
          0,
        )
    : 0;
  return material * 10 + pressure;
}

function tacticalBonus(before: GameState, after: GameState, action: GameAction): number {
  const actor = getPiece(before, action.pieceId);
  if (!actor) return 0;
  const enemy = actor.owner === 0 ? 1 : 0;
  const afterEnemyIds = new Set(
    after.pieces.filter((piece) => piece.owner === enemy).map((piece) => piece.id),
  );
  const capturedValue = before.pieces
    .filter((piece) => piece.owner === enemy && !afterEnemyIds.has(piece.id))
    .reduce((score, piece) => score + PIECE_VALUE[piece.type] * 40, 0);
  const oldFortress = before.pieces.find(
    (piece) => piece.type === 'fortress' && piece.owner === enemy,
  );
  const newFortress = after.pieces.find(
    (piece) => piece.type === 'fortress' && piece.owner === enemy,
  );
  const fortressDamage =
    oldFortress?.type === 'fortress'
      ? (oldFortress.hp - (newFortress?.type === 'fortress' ? newFortress.hp : 0)) * 20_000
      : 0;
  const passivePenalty =
    action.kind === 'rotate' || action.kind === 'orient'
      ? -12
      : action.kind === 'transform'
        ? -3
        : 0;
  return capturedValue + fortressDamage + passivePenalty;
}

function stableActionBias(action: GameAction): number {
  const key = JSON.stringify(action);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 1000) / 1_000_000;
}
