import { getFiringRangeCells, isProtectedByPlayer } from './engine.js';
import { materialValue } from './ai-material.js';
import { directionBetween, hexDistance, hexKey, stepHex } from './hex.js';
import type { GameAction, GameState, Piece, Player } from './types.js';

type RangedPiece = Extract<Piece, { type: 'airplane' | 'long' | 'medium' }>;

/** Additional strategic value of reusable air fire and unspent long-range ammunition. */
export function rangedMaterialBonus(piece: Piece): number {
  if (piece.type === 'airplane') return 160;
  if (piece.type === 'long') return (piece.missilesRemaining ?? 2) * 50;
  return 0;
}

function targetValue(piece: Piece, expertCoaching: boolean): number {
  if (piece.type === 'fortress') return piece.hp === 1 ? 900 : 600;
  return materialValue(piece, expertCoaching) + rangedMaterialBonus(piece);
}

function batteryScore(
  state: GameState,
  piece: RangedPiece,
  preview: Parameters<typeof getFiringRangeCells>[2] = {},
  expertCoaching = false,
): number {
  if (piece.type === 'long' && (piece.missilesRemaining ?? 2) === 0) return 0;
  const origin = preview.position ?? piece.position;
  const enemy = piece.owner === 0 ? 1 : 0;
  const targets = state.pieces.filter(
    (target) =>
      target.owner === enemy &&
      target.type !== 'antiAir' &&
      !isProtectedByPlayer(state, target.position, enemy),
  );
  if (!targets.length) return 0;
  const range = new Set(getFiringRangeCells(state, piece.id, preview).map(hexKey));
  let readiness = 0;
  let threat = 0;
  let alternative = 0;
  for (const target of targets) {
    const distance = hexDistance(origin, target.position);
    // Launchers need the three-hex ring, rather than closing to melee distance.
    // This is a deployment estimate; firing arcs and shield rays come from the engine.
    const gap = piece.type === 'long' ? Math.abs(distance - 3) : Math.max(0, distance - 3);
    readiness = Math.max(readiness, Math.max(0, 5 - gap) * 14);
    if (range.has(hexKey(target.position))) {
      const value = targetValue(target, expertCoaching);
      if (value > threat) {
        alternative = threat;
        threat = value;
      } else alternative = Math.max(alternative, value);
    }
  }
  // A unit can shoot one target per turn. A bounded fork bonus discourages exposing
  // several units to it, without adding every victim as a simultaneous material gain.
  const tempo = state.activePlayer === piece.owner ? 0.28 : 0.18;
  return readiness + (threat + alternative * 0.25) * tempo;
}

/** Shared positional supplement; neural calls retain their calibrated default values. */
export function evaluateRangedState(
  state: GameState,
  player: Player,
  expertCoaching = false,
): number {
  if (state.outcome) return 0;
  let score = 0;
  for (const piece of state.pieces) {
    const sign = piece.owner === player ? 1 : -1;
    score += sign * rangedMaterialBonus(piece);
    if (piece.type === 'airplane' || piece.type === 'long' || piece.type === 'medium')
      score += sign * batteryScore(state, piece, undefined, expertCoaching);
  }
  return score;
}

/** Order legal deployments before pruning quiet alternatives at interior nodes. */
export function rangedActionPriority(
  state: GameState,
  action: GameAction,
  expertCoaching = false,
): number {
  const piece = state.pieces.find((candidate) => candidate.id === action.pieceId);
  if (!piece) return 0;
  if (piece.type !== 'airplane' && piece.type !== 'long' && piece.type !== 'medium') return 0;
  if (action.kind === 'orient' && piece.type === 'medium')
    return batteryScore(state, piece, { cannon: action.cannon }, expertCoaching);
  if (action.kind !== 'move' || action.kamikaze) return 0;
  if (piece.type === 'airplane') {
    const direction = directionBetween(piece.position, action.to);
    if (direction === null) return 0;
    const enemy = piece.owner === 0 ? 1 : 0;
    for (let step = 1; step <= hexDistance(piece.position, action.to); step += 1) {
      if (isProtectedByPlayer(state, stepHex(piece.position, direction, step), enemy)) return -1000;
    }
    return batteryScore(state, piece, { position: action.to, facing: direction }, expertCoaching);
  }
  return batteryScore(
    state,
    piece,
    {
      position: action.to,
      ...(piece.type === 'medium' ? { cannon: action.cannon } : {}),
    },
    expertCoaching,
  );
}
