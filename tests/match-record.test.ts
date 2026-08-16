import { describe, expect, it } from 'vitest';

import { applyAction, getAllLegalActions, validateState } from '../src/engine';
import { createClassicConfig, validateMatchConfig } from '../src/game-config';
import {
  ReplayError,
  appendAction,
  createMatchRecord,
  parseRecord,
  replayRecord,
  serializeRecord,
} from '../src/match-record';
import { SCENARIOS, evaluateScenario } from '../src/scenarios';

describe('configuración, invariantes y diario', () => {
  it('valida classic-v2 y todos los escenarios', () => {
    const config = createClassicConfig({ mode: 'local' });
    expect(validateMatchConfig(config)).toEqual([]);
    expect(validateState(createMatchRecord(config).initialState, config)).toEqual([]);
    for (const scenario of SCENARIOS) {
      const scenarioConfig = {
        ...config,
        definitionId: `scenario:${scenario.id}`,
        setup: scenario.initialState.pieces.map((piece) => ({ id: piece.id, piece })),
      };
      expect(validateMatchConfig(scenarioConfig), scenario.id).toEqual([]);
      expect(validateState(scenario.initialState, scenarioConfig), scenario.id).toEqual([]);
      expect(getAllLegalActions(scenario.initialState).length, scenario.id).toBeGreaterThan(0);
      const solves = getAllLegalActions(scenario.initialState).some((action) => {
        const result = applyAction(scenario.initialState, action);
        return result.ok && evaluateScenario(scenario, scenario.initialState, result.state, action);
      });
      expect(solves, `${scenario.id} debe tener una solución legal inmediata`).toBe(true);
    }
  });

  it('configura ambas Fortalezas con entre 1 y 3 HP', () => {
    for (const fortressHp of [1, 2, 3] as const) {
      const config = createClassicConfig({ mode: 'local', fortressHp });
      expect(
        config.setup
          .filter(({ piece }) => piece.type === 'fortress')
          .map(({ piece }) => (piece.type === 'fortress' ? piece.hp : 0)),
      ).toEqual([fortressHp, fortressHp]);
      expect(validateMatchConfig(config)).toEqual([]);
    }
  });

  it('permite alternar entre las dos disposiciones iniciales', () => {
    for (const initialLayout of [1, 2] as const) {
      const config = createClassicConfig({ mode: 'local', initialLayout });
      const typeAt = (owner: 0 | 1, q: number, r: number) =>
        config.setup.find(
          ({ piece }) => piece.owner === owner && piece.position.q === q && piece.position.r === r,
        )?.piece.type;

      expect(typeAt(0, 3, -4)).toBe(initialLayout === 1 ? 'long' : 'capturer');
      expect(typeAt(0, -3, -1)).toBe(initialLayout === 1 ? 'long' : 'capturer');
      expect(typeAt(0, 0, -3)).toBe(initialLayout === 1 ? 'capturer' : 'long');
      expect(typeAt(1, -3, 4)).toBe(initialLayout === 1 ? 'long' : 'capturer');
      expect(typeAt(1, 3, 1)).toBe(initialLayout === 1 ? 'long' : 'capturer');
      expect(typeAt(1, 0, 3)).toBe(initialLayout === 1 ? 'capturer' : 'long');
      expect(
        config.setup.filter(({ piece }) => piece.owner === 0 && piece.type === 'capturer'),
      ).toHaveLength(initialLayout === 1 ? 1 : 2);
      expect(
        config.setup.filter(({ piece }) => piece.owner === 0 && piece.type === 'long'),
      ).toHaveLength(initialLayout === 1 ? 2 : 1);
      expect(validateMatchConfig(config)).toEqual([]);
      const record = createMatchRecord(config);
      expect(validateState(record.initialState, config)).toEqual([]);
      expect(parseRecord(serializeRecord(record))).toEqual(record);
    }
  });

  it('reproduce la misma secuencia y conserva el estado inicial', () => {
    const record = createMatchRecord(createClassicConfig({ mode: 'local' }));
    let expected = structuredClone(record.initialState);
    let nextRecord = record;
    for (let index = 0; index < 6; index += 1) {
      const action = getAllLegalActions(expected)[0];
      expect(action).toBeDefined();
      const result = applyAction(expected, action);
      expect(result.ok).toBe(true);
      expected = result.state;
      nextRecord = appendAction(nextRecord, action);
      expect(validateState(expected)).toEqual([]);
    }
    expect(replayRecord(nextRecord)).toEqual(expected);
    expect(record.actions).toHaveLength(0);
    expect(parseRecord(serializeRecord(nextRecord))).toEqual(nextRecord);
  });

  it('rechaza versiones incompatibles y acciones manipuladas', () => {
    const record = createMatchRecord(createClassicConfig({ mode: 'local' }));
    expect(() => parseRecord(JSON.stringify({ ...record, version: 99 }))).toThrow(ReplayError);
    expect(() =>
      parseRecord(
        JSON.stringify({
          ...record,
          version: 1,
          config: { ...record.config, rulesetId: 'classic-v1' },
        }),
      ),
    ).toThrow(ReplayError);
    const tampered = {
      ...record,
      actions: [{ kind: 'move', pieceId: 'inexistente', to: { q: 0, r: 0 } }],
      currentAction: 1,
    };
    expect(() => parseRecord(JSON.stringify(tampered))).toThrow(/Acción ilegal/);
  });
});
