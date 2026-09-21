import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACHIEVEMENTS,
  achievementProgressFor,
  createAchievementProgress,
  evaluateAcademyAchievements,
  evaluateMatchAchievements,
  loadAchievementProgress,
  parseAchievementProgress,
  registerAchievementMatch,
  saveAchievementProgress,
  type AchievementId,
  type AchievementProgress,
} from '../src/achievements';
import { applyAction, createGameState, getAllLegalActions } from '../src/engine';
import { createClassicConfig, type MatchConfigInput } from '../src/game-config';
import { appendAction, concludeMatch, createMatchRecord, replayRecord } from '../src/match-record';
import { BASIC_SCENARIOS, SCENARIOS } from '../src/scenarios';
import type { GameAction, MatchRecord, Piece } from '../src/types';

const AT = '2026-09-21T10:00:00.000Z';

function registered(record: MatchRecord, progress = createAchievementProgress()) {
  return registerAchievementMatch(progress, record);
}

function evaluate(record: MatchRecord, progress = registered(record)) {
  return evaluateMatchAchievements(progress, record, { source: 'live', at: AT });
}

function definition(id: AchievementId) {
  return ACHIEVEMENTS.find((entry) => entry.id === id)!;
}

function fixtureRecord(
  pieces: Piece[],
  input: MatchConfigInput = { mode: 'local' },
  activePlayer: 0 | 1 = 0,
) {
  const config = createClassicConfig(input);
  config.setup = pieces.map((piece) => ({ id: piece.id, piece }));
  return createMatchRecord(config, createGameState(pieces, activePlayer));
}

function playedMatch(input: MatchConfigInput = { mode: 'local' }, winner: 0 | 1 = 0) {
  const record = createMatchRecord(createClassicConfig(input));
  const action = getAllLegalActions(record.initialState)[0];
  return concludeMatch(appendAction(record, action), {
    type: 'win',
    winner,
    reason: 'resignation',
  });
}

function fortressWin(input: MatchConfigInput = { mode: 'local' }, extra: Piece[] = []) {
  const record = fixtureRecord(
    [
      { id: 'blue-fort', owner: 0, type: 'fortress', hp: 2, position: { q: -5, r: 0 } },
      { id: 'amber-fort', owner: 1, type: 'fortress', hp: 1, position: { q: 5, r: 0 } },
      { id: 'blue-long', owner: 0, type: 'long', position: { q: 2, r: 0 } },
      ...extra,
    ],
    input,
  );
  return appendAction(record, { kind: 'shoot', pieceId: 'blue-long', targetId: 'amber-fort' });
}

function eventMatch(scenarioId: string, wanted: string, swap = false) {
  const scenario = SCENARIOS.find(({ id }) => id === scenarioId)!;
  const pieces: Piece[] = scenario.initialState.pieces.map((piece) => ({
    ...structuredClone(piece),
    owner: swap ? (piece.owner === 0 ? 1 : 0) : piece.owner,
  }));
  const record = fixtureRecord(pieces, { mode: 'machine' }, swap ? 1 : 0);
  const action = getAllLegalActions(record.initialState).find((candidate) =>
    applyAction(record.initialState, candidate).events.some((event) => event.type === wanted),
  );
  expect(action).toBeDefined();
  const played = appendAction(record, action!);
  const state = replayRecord(played);
  return state.outcome
    ? played
    : concludeMatch(played, { type: 'win', winner: 0, reason: 'resignation' });
}

afterEach(() => vi.unstubAllGlobals());

describe('logros de partidas', () => {
  it('cuenta una partida local una sola vez, conserva las fechas y no muta la entrada', () => {
    const record = playedMatch();
    const before = registered(record);
    const untouched = structuredClone(before);
    const result = evaluate(record, before);
    expect(result.unlocked).toEqual(['first-match', 'local-match', 'local-win', 'first-win']);
    expect(result.progress.counters).toMatchObject({ matches: 1, wins: 1, localMatches: 1 });
    expect(result.progress.unlockedAt['local-win']).toBe(AT);
    expect(result.progress.registeredMatchIds).toEqual([]);
    expect(result.progress.processedMatchIds).toEqual([record.createdAt]);
    expect(before).toEqual(untouched);
    const reloaded = parseAchievementProgress(JSON.stringify(result.progress));
    const repeated = evaluate(record, registered(record, reloaded));
    expect(repeated.unlocked).toEqual([]);
    expect(repeated.progress.counters.matches).toBe(1);
  });

  it('no concede progreso a importaciones, replays, partidas antiguas, escenarios ni abandonos sin órdenes', () => {
    const record = playedMatch();
    const progress = registered(record);
    for (const source of ['import', 'replay'] as const)
      expect(evaluateMatchAchievements(progress, record, { source, at: AT }).progress).toBe(
        progress,
      );
    expect(evaluate(record, createAchievementProgress()).unlocked).toEqual([]);
    const academy = { ...record, config: { ...record.config, definitionId: 'scenario:soldier' } };
    expect(evaluate(academy).unlocked).toEqual([]);
    expect(
      evaluate({ ...record, academySession: { scenarioId: 'soldier', hintsRevealed: 0 } }).unlocked,
    ).toEqual([]);
    expect(evaluate({ ...record, currentAction: 0 }).unlocked).toEqual([]);
    const empty = concludeMatch(createMatchRecord(createClassicConfig({ mode: 'local' })), {
      type: 'win',
      winner: 0,
      reason: 'resignation',
    });
    expect(evaluate(empty).unlocked).toEqual([]);
  });

  it('rechaza diarios ilegales y partidas sin terminar sin consumir su identidad', () => {
    const record = playedMatch();
    const invalid = {
      ...record,
      actions: [{ kind: 'shoot', pieceId: 'missing', targetId: 'missing' } as GameAction],
    };
    expect(evaluate(invalid).unlocked).toEqual([]);
    const unfinished = { ...record, conclusion: null };
    const result = evaluate(unfinished);
    expect(result.progress.counters.matches).toBe(0);
    expect(result.progress.registeredMatchIds).toEqual([record.createdAt]);
  });

  it.each(['recruit', 'tactical', 'commander', 'expert'] as const)(
    'concede solamente la dificultad %s ganada por el humano',
    (difficulty) => {
      const winner = evaluate(playedMatch({ mode: 'machine', difficulty }));
      expect(winner.unlocked.filter((id) => id.startsWith('ai-'))).toEqual([`ai-${difficulty}`]);
      expect(winner.unlocked).not.toContain('local-win');
      const loser = evaluate(playedMatch({ mode: 'machine', difficulty }, 1));
      expect(loser.progress.counters).toMatchObject({ matches: 1, wins: 0 });
      expect(loser.unlocked).toEqual(['first-match']);
    },
  );

  it.each([
    [300, 'clock-5'],
    [600, 'clock-10'],
    [1200, 'clock-20'],
  ] as const)('usa el control de %i segundos y no el tiempo transcurrido', (clockSeconds, id) => {
    const result = evaluate(playedMatch({ mode: 'local', clockSeconds }));
    expect(result.unlocked.filter((unlocked) => unlocked.startsWith('clock-'))).toEqual([id]);
    expect(evaluate(playedMatch({ mode: 'local', clockSeconds: null })).unlocked).not.toContain(id);
  });

  it('mantiene progreso acumulativo al terminar partidas distintas', () => {
    let progress: AchievementProgress = createAchievementProgress();
    const template = playedMatch();
    for (let index = 0; index < 10; index += 1) {
      const record = {
        ...template,
        createdAt: new Date(Date.parse(AT) + index * 1000).toISOString(),
      };
      progress = evaluate(record, registered(record, progress)).progress;
    }
    expect(progress.unlockedAt['matches-10']).toBe(AT);
    expect(progress.unlockedAt['wins-10']).toBe(AT);
    expect(achievementProgressFor(definition('matches-50'), progress)).toMatchObject({
      current: 10,
      target: 50,
      unlocked: false,
    });
    expect(achievementProgressFor(definition('matches-10'), progress)).toMatchObject({
      current: 10,
      target: 10,
      unlocked: true,
    });
  });

  it('distingue eliminar todo el bando rival de dejarle unidades terrestres o aéreas', () => {
    const clean = evaluate(fortressWin());
    expect(clean.unlocked).toContain('clean-sweep');
    expect(clean.unlocked).toContain('untouchable');
    expect(clean.progress.counters.captures).toBe(0);
    for (const type of ['soldier', 'drone'] as const) {
      const survivor: Piece =
        type === 'soldier'
          ? { id: 'survivor', owner: 1, type, facing: 0, position: { q: 0, r: 0 } }
          : { id: 'survivor', owner: 1, type, position: { q: 0, r: 0 } };
      expect(evaluate(fortressWin({ mode: 'local' }, [survivor])).unlocked).not.toContain(
        'clean-sweep',
      );
    }
    expect(evaluate(playedMatch()).unlocked).not.toContain('untouchable');
  });

  it('reconoce una remontada real desde el primer daño hasta ganar con un punto', () => {
    let record = fixtureRecord(
      [
        { id: 'blue-fort', owner: 0, type: 'fortress', hp: 2, position: { q: -5, r: 0 } },
        { id: 'amber-fort', owner: 1, type: 'fortress', hp: 1, position: { q: 5, r: 0 } },
        { id: 'blue-long', owner: 0, type: 'long', position: { q: 2, r: 0 } },
        { id: 'amber-long', owner: 1, type: 'long', position: { q: -2, r: 0 } },
      ],
      { mode: 'machine' },
      1,
    );
    record = appendAction(record, { kind: 'shoot', pieceId: 'amber-long', targetId: 'blue-fort' });
    record = appendAction(record, { kind: 'shoot', pieceId: 'blue-long', targetId: 'amber-fort' });
    const result = evaluate(record);
    expect(result.unlocked).toContain('comeback');
    expect(result.unlocked).not.toContain('untouchable');
    expect(evaluate(fortressWin()).unlocked).not.toContain('comeback');
  });

  it('reconstruye capturas, conversiones y transformaciones del diario legal', () => {
    expect(evaluate(eventMatch('medium', 'destroy')).unlocked).toContain('captures-1');
    expect(evaluate(eventMatch('capture', 'convert')).unlocked).toContain('conversion');
    expect(evaluate(eventMatch('transform', 'transform')).unlocked).toContain('transformation');
  });

  it('atribuye una intercepción al defensor humano y no a la IA ni al dron destruido', () => {
    const aiDefense = evaluate(eventMatch('anti-air', 'intercept'));
    expect(aiDefense.unlocked).not.toContain('interception');
    expect(aiDefense.progress.counters.captures).toBe(0);
    const humanDefense = evaluate(eventMatch('anti-air', 'intercept', true));
    expect(humanDefense.unlocked).toContain('interception');
    expect(humanDefense.progress.counters).toMatchObject({ interceptions: 1, captures: 1 });
  });

  it('cuenta la intercepción de un dron que cambia de bando durante esa misma orden', () => {
    let record = fixtureRecord(
      [
        { id: 'blue-fort', owner: 0, type: 'fortress', hp: 2, position: { q: -5, r: 0 } },
        { id: 'amber-fort', owner: 1, type: 'fortress', hp: 2, position: { q: 5, r: 0 } },
        { id: 'blue-drone', owner: 0, type: 'drone', position: { q: 0, r: 0 } },
        { id: 'blue-aa', owner: 0, type: 'antiAir', position: { q: 1, r: 0 } },
        { id: 'amber-capturer', owner: 1, type: 'capturer', position: { q: 0, r: -1 } },
      ],
      { mode: 'machine' },
      1,
    );
    const action: GameAction = {
      kind: 'convert',
      pieceId: 'amber-capturer',
      targetId: 'blue-drone',
    };
    const result = applyAction(record.initialState, action);
    expect(result.ok).toBe(true);
    expect(result.events.map(({ type }) => type)).toEqual(
      expect.arrayContaining(['convert', 'intercept']),
    );
    record = appendAction(record, action);
    record = concludeMatch(record, { type: 'win', winner: 0, reason: 'resignation' });
    expect(evaluate(record).progress.counters).toMatchObject({
      captures: 1,
      interceptions: 1,
      conversions: 0,
    });
  });

  it('no cuenta los sacrificios ni premios tácticos de órdenes deshechas', () => {
    const record = eventMatch('fortress', 'fortressDamage');
    expect(evaluate(record).progress.counters.captures).toBe(0);
    const captured = eventMatch('medium', 'destroy');
    const undone = { ...captured, actions: [], currentAction: 0, conclusion: null };
    expect(evaluate(undone).progress.counters.captures).toBe(0);
  });
});

describe('logros de Academia y guardado', () => {
  it('diferencia tutorial, Academia completa, medallas y reto diario sin duplicar progreso', () => {
    const initial = createAchievementProgress();
    const basicIds = BASIC_SCENARIOS.map(({ id }) => id);
    const basic = evaluateAcademyAchievements(
      initial,
      [...basicIds, ...basicIds, 'custom:fake'],
      basicIds.slice(0, 3),
      AT,
    );
    expect(basic.unlocked).toEqual(['academy-first', 'tutorial-complete', 'academy-gold']);
    expect(basic.progress.completedScenarioIds).toEqual(basicIds);
    expect(initial.completedScenarioIds).toEqual([]);
    const complete = evaluateAcademyAchievements(
      basic.progress,
      SCENARIOS.map(({ id }) => id),
      [],
      AT,
    );
    expect(complete.unlocked).toEqual(['academy-complete']);
    const daily = evaluateAcademyAchievements(
      complete.progress,
      ['daily:2026-09-21:abc123'],
      [],
      AT,
    );
    expect(daily.unlocked).toEqual(['daily-first']);
    const repeat = evaluateAcademyAchievements(daily.progress, ['daily:2026-09-21:abc123'], [], AT);
    expect(repeat.progress).toBe(daily.progress);
    expect(repeat.unlocked).toEqual([]);
  });

  it('requiere completar cada lección premiada con oro y conserva logros tras reiniciar Academia', () => {
    const ids = BASIC_SCENARIOS.slice(0, 3).map(({ id }) => id);
    const pending = evaluateAcademyAchievements(createAchievementProgress(), [], ids, AT);
    expect(pending.progress.goldScenarioIds).toEqual([]);
    const earned = evaluateAcademyAchievements(pending.progress, ids, ids, AT);
    const reset = evaluateAcademyAchievements(earned.progress, [], [], AT);
    expect(reset.progress.unlockedAt['academy-gold']).toBe(AT);
    expect(reset.progress.goldScenarioIds).toEqual(ids);
  });

  it('tolera versiones desconocidas, JSON corrupto y campos dañados sin inventar logros', () => {
    expect(parseAchievementProgress('{')).toEqual(createAchievementProgress());
    expect(parseAchievementProgress('{"version":2,"counters":{"matches":999}}')).toEqual(
      createAchievementProgress(),
    );
    const parsed = parseAchievementProgress(
      JSON.stringify({
        version: 1,
        counters: { matches: 4, wins: -1, captures: '100', localMatches: 1.5 },
        unlockedAt: { 'first-match': AT, 'ai-expert': 'bad-date', fake: AT },
        registeredMatchIds: [AT, AT, false, 'bad-date'],
        processedMatchIds: [AT, AT],
        completedScenarioIds: ['movement', 'movement', 'custom:fake'],
        goldScenarioIds: ['capture', 'movement'],
      }),
    );
    expect(parsed.counters).toMatchObject({ matches: 4, wins: 0, captures: 0, localMatches: 0 });
    expect(parsed.unlockedAt).toEqual({ 'first-match': AT });
    expect(parsed.registeredMatchIds).toEqual([AT]);
    expect(parsed.processedMatchIds).toEqual([AT]);
    expect(parsed.completedScenarioIds).toEqual(['movement']);
    expect(parsed.goldScenarioIds).toEqual(['movement']);
  });

  it('recupera el progreso persistente y mantiene funcionamiento si falla el almacenamiento', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    const progress = evaluate(playedMatch()).progress;
    expect(saveAchievementProgress(progress)).toBe(true);
    expect(loadAchievementProgress()).toEqual(progress);
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('quota');
      },
    });
    expect(loadAchievementProgress()).toEqual(createAchievementProgress());
    expect(saveAchievementProgress(progress)).toBe(false);
  });

  it('incluye identificadores únicos y objetivos alcanzables para todos los logros', () => {
    expect(new Set(ACHIEVEMENTS.map(({ id }) => id)).size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS).toHaveLength(28);
    expect(
      ACHIEVEMENTS.every(
        ({ title, description, target }) =>
          title.length > 0 && description.length > 0 && target > 0,
      ),
    ).toBe(true);
  });
});
