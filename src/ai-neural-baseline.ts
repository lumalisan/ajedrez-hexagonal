import type { GameState, PieceType, Player } from './types.js';

/** Versioned model contract: changing this valuation requires a new baseline identifier. */
export const NEURAL_MATERIAL_BASELINE = 'material-fortress-v1';

// Serialized model semantics: keep these coefficients stable when tuning other AI heuristics.
// Airplane includes its reusable-fire bonus; a launcher's remaining missile is worth 110+50.
const UNIT_VALUES_V1: Readonly<Record<Exclude<PieceType, 'fortress' | 'long'>, number>> = {
  soldier: 100,
  capturer: 320,
  medium: 420,
  fast: 850,
  drone: 450,
  airplane: 860,
  antiAir: 300,
};

/** Cheap zero-sum baseline; legality, tactical selection and terminal scores stay in the engine. */
export function evaluateNeuralMaterialBaseline(state: GameState, player: Player): number {
  let score = 0;
  for (const piece of state.pieces) {
    const value =
      piece.type === 'fortress'
        ? piece.hp * 7_500
        : piece.type === 'long'
          ? 180 + 160 * (piece.missilesRemaining ?? 2)
          : UNIT_VALUES_V1[piece.type];
    score += (piece.owner === player ? 1 : -1) * value;
  }
  return score;
}
