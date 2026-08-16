import { describe, expect, it } from 'vitest';

import {
  CLASSIC_NO_PROGRESS_LIMIT,
  CLASSIC_REPETITION_LIMIT,
  CLASSIC_RULESET_ID,
  CLASSIC_RULES_NOTE,
  FORTRESS_DAMAGE_PER_HIT,
  FORTRESS_SACRIFICE_ATTACKERS,
  fortressAttackSummary,
} from '../src/classic-rules';

describe('contrato de reglas classic-v2', () => {
  it('expone una única configuración canónica para finales y Fortaleza', () => {
    expect(CLASSIC_RULESET_ID).toBe('classic-v2');
    expect(CLASSIC_REPETITION_LIMIT).toBe(3);
    expect(CLASSIC_NO_PROGRESS_LIMIT).toBe(120);
    expect(FORTRESS_DAMAGE_PER_HIT).toBe(1);
    expect(FORTRESS_SACRIFICE_ATTACKERS).toEqual(['soldier', 'capturer', 'fast']);
  });

  it('describe correctamente Fortalezas de uno o varios puntos de vida', () => {
    expect(fortressAttackSummary(1)).toContain('1 punto de vida');
    expect(fortressAttackSummary(1)).not.toContain('1 puntos de vida');
    expect(fortressAttackSummary(3)).toContain('3 puntos de vida');
    expect(fortressAttackSummary(3)).toContain('Cada impacto causa 1 punto');
  });

  it('mantiene la nota de reglas alineada con la tercera repetición', () => {
    expect(CLASSIC_RULES_NOTE).toContain('classic-v2');
    expect(CLASSIC_RULES_NOTE).toContain('tercera repetición');
    expect(CLASSIC_RULES_NOTE).toContain('reduce 1 punto');
  });
});
