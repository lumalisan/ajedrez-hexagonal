import type { PieceType } from './types.js';

export const CLASSIC_RULESET_ID = 'classic-v2' as const;
/** Historical thresholds retained for legacy recordings. New games disable these draws. */
export const CLASSIC_REPETITION_LIMIT = 3;
export const CLASSIC_NO_PROGRESS_LIMIT = 120;
export const CLASSIC_ORIENTATION_TURN_LIMIT = 5;
export const FORTRESS_DAMAGE_PER_HIT = 1;
export const FORTRESS_SACRIFICE_ATTACKERS: readonly PieceType[] = ['soldier', 'capturer', 'fast'];

export function fortressAttackSummary(maxHp: number): string {
  const pointLabel = maxHp === 1 ? 'punto de vida' : 'puntos de vida';
  return `La Fortaleza tiene ${maxHp} ${pointLabel}. Cada impacto causa ${FORTRESS_DAMAGE_PER_HIT} punto; Asaltador, Capturador y Embestidor se sacrifican al atacarla.`;
}

export const CLASSIC_RULES_NOTE =
  'Reglas classic-v2: cada impacto reduce 1 punto de Fortaleza; Asaltador, Capturador y Embestidor se sacrifican; cinco turnos propios consecutivos dedicados solo a orientar asaltadores o cañones de tanques causan la derrota, con advertencia antes de confirmar el quinto.';
