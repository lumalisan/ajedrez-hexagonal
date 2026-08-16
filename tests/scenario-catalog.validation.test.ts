import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createClassicConfig } from '../src/game-config';
import { createMatchRecord } from '../src/match-record';
import {
  loadScenarioCatalog,
  saveCustomScenario,
  validateCustomScenario,
  type CustomScenario,
} from '../src/scenario-catalog';
import type { ScenarioObjective } from '../src/types';
import { installMemoryStorage } from './helpers/memory-storage';

describe('validación del catálogo de escenarios', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('acepta, clona y persiste un objetivo de alcance válido', () => {
    const base = scenario({
      kind: 'reach',
      pieceId: 'azul-fortress-15',
      target: { q: 0, r: -4 },
    });
    const validated = validateCustomScenario(base);

    expect(validated).toEqual(base);
    expect(validated).not.toBe(base);
    saveCustomScenario(base);
    expect(loadScenarioCatalog()).toEqual([base]);
  });

  it.each([
    [{ kind: 'win-in', maxPlies: 0 }, /límite positivo/u],
    [{ kind: 'survive', plies: 0 }, /duración positiva/u],
    [{ kind: 'protect-piece', pieceId: 'azul-fortress-15', plies: -1 }, /duración positiva/u],
    [
      { kind: 'reach', pieceId: 'azul-fortress-15', target: { q: 0.5, r: 0 } },
      /coordenadas enteras/u,
    ],
  ] as const)('rechaza parámetros inválidos del objetivo %#', (objective, message) => {
    expect(() => validateCustomScenario(scenario(objective as ScenarioObjective))).toThrow(message);
  });

  it.each([
    { kind: 'protect-piece', pieceId: 'unidad-inexistente', plies: 3 },
    { kind: 'reach', pieceId: 'unidad-inexistente', target: { q: 0, r: 0 } },
  ] satisfies ScenarioObjective[])('rechaza una pieza objetivo inexistente: $kind', (objective) => {
    expect(() => validateCustomScenario(scenario(objective))).toThrow(/no existe/u);
  });

  it('rechaza un destino de alcance fuera del tablero configurado', () => {
    expect(() =>
      validateCustomScenario(
        scenario({
          kind: 'reach',
          pieceId: 'azul-fortress-15',
          target: { q: 99, r: -99 },
        }),
      ),
    ).toThrow(/fuera del tablero/u);
  });

  it('ignora entradas corruptas al cargar sin perder escenarios válidos', () => {
    const valid = scenario({ kind: 'win-in', maxPlies: 5 });
    localStorage.setItem(
      'atlas-scenario-catalog-v2',
      JSON.stringify([valid, { ...valid, id: 'roto', objective: { kind: 'win-in', maxPlies: 0 } }]),
    );

    expect(loadScenarioCatalog()).toEqual([valid]);
  });
});

function scenario(objective: ScenarioObjective): CustomScenario {
  const config = createClassicConfig({ mode: 'local' });
  return {
    version: 2,
    id: 'custom-reach',
    title: 'Prueba de objetivo',
    config,
    initialState: createMatchRecord(config).initialState,
    objective,
    maxPlies: 8,
    hints: ['Primera pista', 'Segunda pista'],
    successText: 'Objetivo completado.',
  };
}
