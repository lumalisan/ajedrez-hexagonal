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
  it('valida classic-v1 y todos los escenarios', () => {
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
    const tampered = {
      ...record,
      actions: [{ kind: 'move', pieceId: 'inexistente', to: { q: 0, r: 0 } }],
      currentAction: 1,
    };
    expect(() => parseRecord(JSON.stringify(tampered))).toThrow(/Acción ilegal/);
  });
});
