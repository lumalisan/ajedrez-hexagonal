import { describe, expect, it } from 'vitest';

import { applyAction, getAllLegalActions } from '../src/engine';
import {
  BASIC_SCENARIOS,
  GUIDED_SCENARIOS,
  SCENARIOS,
  STRATEGIC_SCENARIOS,
  dailyScenarioForDate,
  evaluateScenarioProgress,
  nextScenarioHint,
  revealedScenarioHints,
  scenarioLessonAt,
  scenariosByCategory,
} from '../src/scenarios';
import type { GameAction, GameState, ScenarioDefinition } from '../src/types';

type ActionPredicate = (action: GameAction) => boolean;

function legalAction(
  state: GameState,
  pieceId: string,
  kind: GameAction['kind'],
  predicate: ActionPredicate = () => true,
): GameAction {
  const action = getAllLegalActions(state).find(
    (candidate) => candidate.pieceId === pieceId && candidate.kind === kind && predicate(candidate),
  );
  expect(action, `${pieceId} debe tener una orden ${kind}`).toBeDefined();
  return action!;
}

function play(
  scenario: ScenarioDefinition,
  selectors: Array<(state: GameState) => GameAction>,
): ReturnType<typeof evaluateScenarioProgress>[] {
  let state = structuredClone(scenario.initialState);
  const progress: ReturnType<typeof evaluateScenarioProgress>[] = [];
  for (const select of selectors) {
    const before = state;
    const action = select(state);
    const result = applyAction(state, action);
    expect(result.ok, result.error).toBe(true);
    state = result.state;
    progress.push(evaluateScenarioProgress(scenario, before, state, action));
  }
  return progress;
}

const rotate = (pieceId: string, facing: number) => (state: GameState) =>
  legalAction(
    state,
    pieceId,
    'rotate',
    (action) => action.kind === 'rotate' && action.facing === facing,
  );

const shoot = (pieceId: string, targetId: string) => (state: GameState) =>
  legalAction(
    state,
    pieceId,
    'shoot',
    (action) => action.kind === 'shoot' && action.targetId === targetId,
  );

const convert = (pieceId: string, targetId: string) => (state: GameState) =>
  legalAction(
    state,
    pieceId,
    'convert',
    (action) => action.kind === 'convert' && action.targetId === targetId,
  );

describe('Academia 2.0', () => {
  it('conserva los ocho ejercicios básicos y permite agrupar todo el catálogo', () => {
    expect(BASIC_SCENARIOS).toHaveLength(8);
    expect(BASIC_SCENARIOS.map(({ id }) => id)).toEqual([
      'movement',
      'capture',
      'medium',
      'long',
      'drone',
      'anti-air',
      'transform',
      'fortress',
    ]);
    expect(GUIDED_SCENARIOS).toHaveLength(1);
    expect(STRATEGIC_SCENARIOS).toHaveLength(4);
    expect(SCENARIOS).toHaveLength(13);
    expect(scenariosByCategory('basic')).toEqual(BASIC_SCENARIOS);
    expect(scenariosByCategory('guided')).toEqual(GUIDED_SCENARIOS);
    expect(scenariosByCategory('strategic')).toEqual(STRATEGIC_SCENARIOS);
    expect(SCENARIOS.every(({ lesson, difficulty }) => Boolean(lesson && difficulty))).toBe(true);
  });

  it('resuelve la batalla guiada en cinco plies y ofrece feedback por etapas', () => {
    const scenario = GUIDED_SCENARIOS[0];
    const progress = play(scenario, [
      shoot('guided-long', 'guided-blocker-one'),
      rotate('guided-amber-reserve', 0),
      shoot('guided-medium', 'guided-blocker-two'),
      rotate('guided-amber-reserve', 3),
      (state) =>
        legalAction(
          state,
          'guided-fast',
          'move',
          (action) => action.kind === 'move' && action.to.q === 5 && action.to.r === 0,
        ),
    ]);

    expect(progress.slice(0, -1).every(({ status }) => status === 'in-progress')).toBe(true);
    expect(progress.at(-1)).toMatchObject({ status: 'success', elapsedPlies: 5 });
    expect(scenarioLessonAt(scenario, 0)).toContain('Etapa 1');
    expect(scenarioLessonAt(scenario, 4)).toContain('Etapa 5');
    expect(scenarioLessonAt(scenario, 99)).toContain('Etapa 5');
  });

  it('solo declara fracaso al alcanzar el límite de un objetivo win-in', () => {
    const scenario = STRATEGIC_SCENARIOS.find(({ id }) => id === 'strategy-tempo')!;
    const progress = play(scenario, [
      (state) => legalAction(state, 'tempo-long', 'move'),
      rotate('tempo-reserve', 0),
      (state) => legalAction(state, 'tempo-long', 'move'),
    ]);

    expect(progress[0].status).toBe('in-progress');
    expect(progress[1].status).toBe('in-progress');
    expect(progress[2]).toMatchObject({ status: 'failure', reason: 'limit', remainingPlies: 0 });
  });

  it('resuelve presión sostenida con dos impactos dentro del límite', () => {
    const scenario = STRATEGIC_SCENARIOS.find(({ id }) => id === 'strategy-tempo')!;
    const progress = play(scenario, [
      shoot('tempo-long', 'academy-amber-fortress'),
      rotate('tempo-reserve', 0),
      shoot('tempo-long', 'academy-amber-fortress'),
    ]);

    expect(progress.at(-1)).toMatchObject({ status: 'success', elapsedPlies: 3 });
  });

  it('evalúa sobrevivir y proteger durante varias órdenes', () => {
    const survive = STRATEGIC_SCENARIOS.find(({ id }) => id === 'strategy-survive')!;
    const surviveProgress = play(survive, [
      convert('survive-capturer', 'survive-long'),
      rotate('survive-amber-reserve', 0),
      rotate('survive-blue-reserve', 1),
      rotate('survive-amber-reserve', 3),
    ]);
    expect(surviveProgress.at(-1)).toMatchObject({ status: 'success', elapsedPlies: 4 });

    const protect = STRATEGIC_SCENARIOS.find(({ id }) => id === 'strategy-protect')!;
    const protectProgress = play(protect, [
      convert('protect-capturer', 'protect-long'),
      rotate('protect-amber-reserve', 0),
      rotate('protect-relay', 1),
      rotate('protect-amber-reserve', 3),
      rotate('protect-relay', 0),
    ]);
    expect(protectProgress.at(-1)).toMatchObject({ status: 'success', elapsedPlies: 5 });
  });

  it('falla de inmediato si se pierde la pieza protegida', () => {
    const scenario = STRATEGIC_SCENARIOS.find(({ id }) => id === 'strategy-protect')!;
    const progress = play(scenario, [
      rotate('protect-relay', 1),
      shoot('protect-long', 'protect-relay'),
    ]);

    expect(progress[0].status).toBe('in-progress');
    expect(progress[1]).toMatchObject({ status: 'failure', reason: 'protected-piece-lost' });
  });

  it('resuelve el objetivo de alcanzar una casilla y falla si agota el límite', () => {
    const scenario = STRATEGIC_SCENARIOS.find(({ id }) => id === 'strategy-reach')!;
    const success = play(scenario, [
      (state) =>
        legalAction(
          state,
          'reach-scout',
          'move',
          (action) => action.kind === 'move' && action.to.q === 0 && action.to.r === -1,
        ),
      rotate('reach-amber-reserve', 0),
      (state) =>
        legalAction(
          state,
          'reach-scout',
          'move',
          (action) => action.kind === 'move' && action.to.q === 0 && action.to.r === -2,
        ),
    ]);
    expect(success.at(-1)).toMatchObject({ status: 'success', elapsedPlies: 3 });

    const failure = play(scenario, [
      rotate('reach-scout', 1),
      rotate('reach-amber-reserve', 0),
      rotate('reach-scout', 0),
    ]);
    expect(failure.at(-1)).toMatchObject({ status: 'failure', reason: 'limit' });
  });

  it('revela pistas progresivamente sin mutar el escenario', () => {
    const scenario = GUIDED_SCENARIOS[0];
    const originalHints = [...scenario.hints];

    const first = nextScenarioHint(scenario, 0);
    const second = nextScenarioHint(scenario, first.revealedCount);
    const last = nextScenarioHint(scenario, scenario.hints.length - 1);
    const exhausted = nextScenarioHint(scenario, scenario.hints.length);

    expect(first).toMatchObject({ hint: scenario.hints[0], revealedCount: 1, exhausted: false });
    expect(second.hint).toBe(scenario.hints[1]);
    expect(last).toMatchObject({
      hint: scenario.hints.at(-1),
      revealedCount: scenario.hints.length,
      exhausted: true,
    });
    expect(exhausted.hint).toBeNull();
    expect(revealedScenarioHints(scenario, 2)).toEqual(scenario.hints.slice(0, 2));
    expect(scenario.hints).toEqual(originalHints);
  });

  it('genera un reto diario determinista por fecha y semilla sin mutar plantillas', () => {
    const snapshot = structuredClone(STRATEGIC_SCENARIOS);
    const first = dailyScenarioForDate('2026-08-16', 'equipo-cian');
    const repeated = dailyScenarioForDate('2026-08-16', 'equipo-cian');
    const nextDay = dailyScenarioForDate('2026-08-17', 'equipo-cian');
    const anotherSeed = dailyScenarioForDate('2026-08-16', 'equipo-ambar');

    expect(repeated).toEqual(first);
    expect(first.category).toBe('daily');
    expect(first.id).toContain('2026-08-16');
    expect(nextDay.id).not.toBe(first.id);
    expect(anotherSeed.id).not.toBe(first.id);
    expect(STRATEGIC_SCENARIOS).toEqual(snapshot);
    expect(() => dailyScenarioForDate('fecha-imposible')).toThrow(RangeError);
  });
});
