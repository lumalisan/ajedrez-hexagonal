import type { Piece, PieceType } from './types.js';

/** Strategic exchange values, not rules or UI scores. Persistent threats matter. */
export const AI_PIECE_VALUE: Readonly<Record<PieceType, number>> = {
  soldier: 100,
  capturer: 320,
  medium: 420,
  long: 400,
  fast: 850,
  drone: 450,
  airplane: 700,
  antiAir: 300,
  fortress: 0,
};

/** Expert preserves the Embestidor; the default remains the trained neural baseline. */
export function materialValue(piece: Piece, expertCoaching = false): number {
  if (expertCoaching && piece.type === 'fast') return 1400;
  return piece.type === 'long'
    ? 180 + 110 * (piece.missilesRemaining ?? 2)
    : AI_PIECE_VALUE[piece.type];
}
