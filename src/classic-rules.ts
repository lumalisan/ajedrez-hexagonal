import type { PieceType } from './types';

export const CLASSIC_RULESET_ID = 'classic-v2' as const;
export const CLASSIC_REPETITION_LIMIT = 3;
export const CLASSIC_NO_PROGRESS_LIMIT = 120;
export const FORTRESS_DAMAGE_PER_HIT = 1;
export const FORTRESS_SACRIFICE_ATTACKERS: readonly PieceType[] = ['soldier', 'capturer', 'fast'];

export function fortressAttackSummary(maxHp: number): string {
  const pointLabel = maxHp === 1 ? 'punto de vida' : 'puntos de vida';
  return `La Fortaleza tiene ${maxHp} ${pointLabel}. Cada impacto causa ${FORTRESS_DAMAGE_PER_HIT} punto; Soldado, Capturador y Embestidor se sacrifican al atacarla.`;
}

export const CLASSIC_RULES_NOTE =
  'Reglas classic-v2: cada impacto reduce 1 punto de Fortaleza; Soldado, Capturador y Embestidor se sacrifican; la tercera repetición o 120 órdenes sin captura, intercepción ni daño terminan en tablas.';
