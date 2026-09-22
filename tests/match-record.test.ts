import { describe, expect, it } from 'vitest';

import {
  applyAction,
  createGameState,
  getAllLegalActions,
  getLegalActionsForPiece,
  validateState,
} from '../src/engine';
import { createClassicConfig, validateMatchConfig } from '../src/game-config';
import { clockOutcome, resumeMatchClock, tickMatchClock } from '../src/match-clock';
import {
  ReplayError,
  appendAction,
  calculateStatistics,
  concludeMatch,
  createMatchRecord,
  parseRecord,
  replayRecord,
  serializeRecord,
  setMatchClock,
} from '../src/match-record';
import { SCENARIOS, evaluateScenario } from '../src/scenarios';

describe('configuración, invariantes y diario', () => {
  it.each([null, 300])(
    'conserva el reloj por turno con total %s al guardar e importar',
    (total) => {
      const config = createClassicConfig({
        mode: 'local',
        clockSeconds: total,
        turnClockSeconds: 30,
      });
      let record = createMatchRecord(config);
      const running = resumeMatchClock(record.clock!, 1_000);
      record = setMatchClock(record, tickMatchClock(running, 6_000));
      const restored = parseRecord(serializeRecord(record));
      expect(restored).toEqual(record);
      expect(restored.clock?.turnRemainingMs).toBe(25_000);
      const expired = tickMatchClock(restored.clock!, 31_000);
      record = concludeMatch(setMatchClock(restored, expired), clockOutcome(expired)!);
      expect(replayRecord(parseRecord(serializeRecord(record))).outcome).toEqual({
        type: 'win',
        winner: 1,
        reason: 'timeout',
      });
    },
  );

  it('valida límites por turno y rechaza alteraciones del reloj configurado', () => {
    for (const turnClockSeconds of [0, -1, Infinity, 0.00001]) {
      expect(
        validateMatchConfig(createClassicConfig({ mode: 'local', turnClockSeconds })),
      ).toContain('El tiempo por turno debe ser positivo.');
    }
    const record = createMatchRecord(createClassicConfig({ mode: 'local', turnClockSeconds: 30 }));
    expect(() => setMatchClock(record, null)).toThrow(/reloj por turno/u);
    expect(() => parseRecord(JSON.stringify({ ...record, clock: null }))).toThrow(
      /reloj por turno/u,
    );
    expect(() => setMatchClock(record, { ...record.clock!, turnInitialMs: 60_000 })).toThrow(
      /no coincide con la duración/u,
    );
    expect(() =>
      parseRecord(
        JSON.stringify({
          ...record,
          clock: { ...record.clock, turnRemainingMs: -1 },
        }),
      ),
    ).toThrow(/tiempo restante del turno/u);
  });

  it('importa un reloj total antiguo sin opciones ni campos por turno', () => {
    const record = createMatchRecord(createClassicConfig({ mode: 'local', clockSeconds: 300 }));
    delete record.config.options.turnClockSeconds;
    expect(parseRecord(serializeRecord(record))).toEqual(record);
    expect(record.clock?.turnInitialMs).toBeUndefined();
  });

  it('valida classic-v2 y todos los escenarios', () => {
    const config = createClassicConfig({ mode: 'local' });
    expect(config.victory.repetition).toBe(3);
    expect(config.options.noProgressPlyLimit).toBe(120);
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
      if (scenario.category === 'basic') {
        const solves = getAllLegalActions(scenario.initialState).some((action) => {
          const result = applyAction(scenario.initialState, action);
          return (
            result.ok && evaluateScenario(scenario, scenario.initialState, result.state, action)
          );
        });
        expect(solves, `${scenario.id} debe tener una solución legal inmediata`).toBe(true);
      }
    }
  });

  it('permite reducir o desactivar explícitamente el límite sin progreso', () => {
    expect(
      createClassicConfig({ mode: 'local', noProgressPlyLimit: 40 }).options.noProgressPlyLimit,
    ).toBe(40);
    expect(
      createClassicConfig({ mode: 'local', noProgressPlyLimit: null }).options.noProgressPlyLimit,
    ).toBeNull();
    const invalid = createClassicConfig({ mode: 'local' });
    invalid.options.noProgressPlyLimit = 0;
    expect(validateMatchConfig(invalid)).toContain(
      'El límite de órdenes sin progreso debe ser un entero positivo.',
    );
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

  it('atribuye capturas y daño a Fortaleza al jugador acreditado por cada evento', () => {
    const config = createClassicConfig({ mode: 'local', noProgressPlyLimit: null });
    const captureState = createGameState([
      { id: 'fort-blue', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
      { id: 'fort-amber', type: 'fortress', owner: 1, position: { q: 5, r: 0 }, hp: 2 },
      {
        id: 'blue-soldier',
        type: 'soldier',
        owner: 0,
        position: { q: 0, r: 0 },
        facing: 0,
      },
      {
        id: 'amber-soldier',
        type: 'soldier',
        owner: 1,
        position: { q: 0, r: -1 },
        facing: 3,
      },
    ]);
    const captureAction = getLegalActionsForPiece(captureState, 'blue-soldier').find(
      (action) => action.kind === 'move' && action.to.q === 0 && action.to.r === -1,
    );
    expect(captureAction).toBeDefined();
    const captureRecord = appendAction(createMatchRecord(config, captureState), captureAction!);
    expect(calculateStatistics(captureRecord).captures).toEqual([1, 0]);

    const damageState = createGameState([
      { id: 'fort-blue', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
      { id: 'fort-amber', type: 'fortress', owner: 1, position: { q: 0, r: -1 }, hp: 2 },
      {
        id: 'blue-soldier',
        type: 'soldier',
        owner: 0,
        position: { q: 0, r: 0 },
        facing: 0,
      },
      {
        id: 'amber-mobile',
        type: 'soldier',
        owner: 1,
        position: { q: 2, r: 0 },
        facing: 3,
      },
    ]);
    const damageAction = getLegalActionsForPiece(damageState, 'blue-soldier').find(
      (action) => action.kind === 'move' && action.to.q === 0 && action.to.r === -1,
    );
    expect(damageAction).toBeDefined();
    const damageRecord = appendAction(createMatchRecord(config, damageState), damageAction!);
    const damageStats = calculateStatistics(damageRecord);
    expect(damageStats.fortressDamage).toEqual([1, 0]);
    expect(damageStats.captures).toEqual([0, 1]);
  });

  it('persiste rendición, tablas externas y timeout sin inventar GameActions', () => {
    const baseRecord = createMatchRecord(createClassicConfig({ mode: 'local' }));
    const resignation = concludeMatch(baseRecord, {
      type: 'win',
      winner: 1,
      reason: 'resignation',
    });
    expect(resignation.actions).toEqual([]);
    expect(replayRecord(resignation).outcome).toEqual({
      type: 'win',
      winner: 1,
      reason: 'resignation',
    });
    expect(parseRecord(serializeRecord(resignation)).conclusion).toEqual(resignation.conclusion);

    const blockade = concludeMatch(baseRecord, { type: 'draw', reason: 'blockade' });
    expect(replayRecord(blockade).outcome).toEqual({ type: 'draw', reason: 'blockade' });

    let timed = createMatchRecord(createClassicConfig({ mode: 'local', clockSeconds: 1 }));
    const running = resumeMatchClock(timed.clock!, 100);
    const expired = tickMatchClock(running, 1_100);
    timed = setMatchClock(timed, expired);
    const timeout = clockOutcome(expired);
    expect(timeout).not.toBeNull();
    timed = concludeMatch(timed, timeout!);
    expect(replayRecord(parseRecord(serializeRecord(timed))).outcome).toEqual({
      type: 'win',
      winner: 1,
      reason: 'timeout',
    });
  });

  it('mantiene compatibles los guardados v2 anteriores a conclusión, reloj y no-progreso', () => {
    const modern = createMatchRecord(createClassicConfig({ mode: 'local' }));
    const legacyInitialState = structuredClone(modern.initialState);
    delete legacyInitialState.noProgressPlyCount;
    const { noProgressPlyLimit: _noProgress, ...legacyOptions } = modern.config.options;
    void _noProgress;
    const { conclusion: _conclusion, clock: _clock, ...legacyRecord } = modern;
    void _conclusion;
    void _clock;
    const legacy = {
      ...legacyRecord,
      config: {
        ...modern.config,
        victory: { ...modern.config.victory, repetition: 0 },
        options: legacyOptions,
      },
      initialState: legacyInitialState,
    };
    const parsed = parseRecord(JSON.stringify(legacy));
    expect(parsed.version).toBe(2);
    expect(parsed.conclusion).toBeUndefined();
    expect(parsed.clock).toBeUndefined();
    expect(parsed.config.options.noProgressPlyLimit).toBeUndefined();
    expect(replayRecord(parsed).outcome).toBeNull();
  });

  it('rechaza conclusiones de tablero fabricadas o metadatos incoherentes', () => {
    const record = createMatchRecord(createClassicConfig({ mode: 'local' }));
    expect(() => concludeMatch(record, { type: 'draw', reason: 'repetition' })).toThrow(
      /debe proceder de una orden legal/u,
    );
    expect(() =>
      parseRecord(
        JSON.stringify({
          ...record,
          conclusion: {
            outcome: { type: 'draw', reason: 'blockade' },
            atAction: 2,
            recordedAt: new Date().toISOString(),
          },
        }),
      ),
    ).toThrow(/conclusión no coincide/u);
    const timed = createMatchRecord(createClassicConfig({ mode: 'local', clockSeconds: 10 }));
    expect(() =>
      setMatchClock(timed, {
        ...timed.clock!,
        initialMs: 20_000,
        remainingMs: [20_000, 20_000],
      }),
    ).toThrow(/no coincide con la duración/u);
  });
});
