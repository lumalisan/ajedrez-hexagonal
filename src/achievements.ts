import { replayRecord } from './match-record';
import { BASIC_SCENARIOS, SCENARIOS } from './scenarios';
import type { GameEvent, GameState, MatchRecord, Player } from './types';

const STORAGE_KEY = 'atlas-achievements-v1';

export interface AchievementCounters {
  matches: number;
  wins: number;
  localMatches: number;
  captures: number;
  conversions: number;
  interceptions: number;
  transformations: number;
}

type AchievementMetric =
  | keyof AchievementCounters
  | 'basicScenarios'
  | 'academyScenarios'
  | 'dailyScenarios'
  | 'goldScenarios';

function achievement<const Id extends string>(
  id: Id,
  title: string,
  description: string,
  category: 'matches' | 'tactics' | 'academy',
  target = 1,
  unit = 'logro',
  metric?: AchievementMetric,
) {
  return { id, icon: id, title, description, category, target, unit, metric };
}

export const ACHIEVEMENTS = [
  achievement(
    'first-match',
    'Esto acaba de empezar',
    'Termina tu primera partida local o contra la IA, después de jugar al menos una orden.',
    'matches',
    1,
    'partidas',
    'matches',
  ),
  achievement(
    'local-match',
    'Dos humanos, un tablero',
    'Termina una partida entre dos personas en este dispositivo, después de jugar al menos una orden.',
    'matches',
    1,
    'partidas locales',
    'localMatches',
  ),
  achievement(
    'local-win',
    '¡Chúpate esa!',
    'Gana una partida local contra otra persona. Cuenta la victoria de cualquiera de los dos bandos.',
    'matches',
  ),
  achievement(
    'first-win',
    'Se me da fatal perder',
    'Consigue tu primera victoria: contra la IA o con cualquiera de los bandos en una partida local.',
    'matches',
    1,
    'victorias',
    'wins',
  ),
  achievement(
    'ai-recruit',
    '¿Has probado a reiniciarte?',
    'Gana una partida contra la IA en dificultad Fácil.',
    'matches',
  ),
  achievement(
    'ai-tactical',
    'Tu algoritmo tiene goteras',
    'Gana una partida contra la IA en dificultad Media.',
    'matches',
  ),
  achievement(
    'ai-commander',
    'Hoy mando yo',
    'Gana una partida contra la IA en dificultad Difícil.',
    'matches',
  ),
  achievement(
    'ai-expert',
    'Captcha superado',
    'Gana una partida contra la IA en dificultad Experto.',
    'matches',
  ),
  achievement(
    'clock-5',
    'Me da tiempo antes del café',
    'Gana una partida con el reloj configurado a 5 minutos por bando.',
    'matches',
  ),
  achievement(
    'clock-10',
    'Diez minutos de gloria',
    'Gana una partida con el reloj configurado a 10 minutos por bando.',
    'matches',
  ),
  achievement(
    'clock-20',
    'Sin prisa, pero con conquista',
    'Gana una partida con el reloj configurado a 20 minutos por bando.',
    'matches',
  ),
  achievement(
    'matches-10',
    'Una más y lo dejo',
    'Termina 10 partidas locales o contra la IA. Cada partida debe incluir al menos una orden.',
    'matches',
    10,
    'partidas',
    'matches',
  ),
  achievement(
    'matches-50',
    'El tablero paga alquiler',
    'Termina 50 partidas locales o contra la IA. Cada partida debe incluir al menos una orden.',
    'matches',
    50,
    'partidas',
    'matches',
  ),
  achievement(
    'wins-10',
    'No era suerte',
    'Acumula 10 victorias contra la IA o entre humanos en este dispositivo.',
    'matches',
    10,
    'victorias',
    'wins',
  ),
  achievement(
    'captures-1',
    'Aquí sobraba alguien',
    'Elimina una unidad rival. No cuentan Fortalezas ni sacrificios del rival.',
    'tactics',
    1,
    'unidades eliminadas',
    'captures',
  ),
  achievement(
    'captures-25',
    'Servicio de limpieza',
    'Elimina 25 unidades rivales. No cuentan Fortalezas ni sacrificios del rival.',
    'tactics',
    25,
    'unidades eliminadas',
    'captures',
  ),
  achievement(
    'captures-100',
    '¿Quién recoge todo esto?',
    'Elimina 100 unidades rivales. No cuentan Fortalezas ni sacrificios del rival.',
    'tactics',
    100,
    'unidades eliminadas',
    'captures',
  ),
  achievement(
    'conversion',
    'Ahora somos familia',
    'Cambia de bando una unidad rival con un Capturador.',
    'tactics',
    1,
    'conversiones',
    'conversions',
  ),
  achievement(
    'interception',
    'Prohibido aparcar arriba',
    'Intercepta una unidad aérea rival con tu defensa antiaérea.',
    'tactics',
    1,
    'intercepciones',
    'interceptions',
  ),
  achievement(
    'transformation',
    'Me bajo aquí',
    'Transforma uno de tus vehículos en Soldado.',
    'tactics',
    1,
    'transformaciones',
    'transformations',
  ),
  achievement(
    'clean-sweep',
    '¿Hola? ¿Queda alguien?',
    'Gana destruyendo la Fortaleza rival cuando ya no quede ninguna otra pieza de ese bando en el tablero.',
    'tactics',
  ),
  achievement(
    'untouchable',
    'Ni un rasguño',
    'Gana destruyendo la Fortaleza rival sin que tu propia Fortaleza haya perdido ningún punto de integridad.',
    'tactics',
  ),
  achievement(
    'comeback',
    'Era parte del plan',
    'Gana destruyendo la Fortaleza rival tras recibir el primer daño de la partida. Tu Fortaleza debe empezar con 2 o 3 puntos y acabar con 1.',
    'tactics',
  ),
  achievement(
    'academy-first',
    'Yo he venido a aprender',
    'Completa una lección de la Academia.',
    'academy',
    1,
    'lecciones',
    'academyScenarios',
  ),
  achievement(
    'tutorial-complete',
    'Ya sé dónde está el gatillo',
    'Completa las 8 lecciones básicas del tutorial de la Academia.',
    'academy',
    BASIC_SCENARIOS.length,
    'lecciones básicas',
    'basicScenarios',
  ),
  achievement(
    'academy-complete',
    'Licenciado en hexágonos',
    'Completa todas las lecciones básicas, guiadas y estratégicas de la Academia. Los retos diarios no son necesarios.',
    'academy',
    SCENARIOS.length,
    'lecciones',
    'academyScenarios',
  ),
  achievement(
    'daily-first',
    'La tarea de hoy está hecha',
    'Completa un reto diario de la Academia.',
    'academy',
    1,
    'retos diarios',
    'dailyScenarios',
  ),
  achievement(
    'academy-gold',
    'Empollón táctico',
    'Consigue medalla de oro en 3 lecciones diferentes de la Academia: resuélvelas sin pistas y dentro de su objetivo de órdenes.',
    'academy',
    3,
    'medallas de oro',
    'goldScenarios',
  ),
] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number]['id'];

export interface AchievementDefinition {
  id: AchievementId;
  icon: AchievementId;
  title: string;
  description: string;
  category: 'matches' | 'tactics' | 'academy';
  target: number;
  unit: string;
  metric?: AchievementMetric;
}

export interface AchievementProgress {
  version: 1;
  counters: AchievementCounters;
  unlockedAt: Partial<Record<AchievementId, string>>;
  /** Only matches started on this device by the live session can earn achievements. */
  registeredMatchIds: string[];
  /** Never prune these IDs: undo, restart, and replay must not count a match twice. */
  processedMatchIds: string[];
  /** Credited tactical events survive undo and reload until the match is processed. */
  processedTacticalEvents: Record<string, string[]>;
  completedScenarioIds: string[];
  goldScenarioIds: string[];
}

export interface AchievementUpdate {
  progress: AchievementProgress;
  unlocked: AchievementId[];
}

export function createAchievementProgress(): AchievementProgress {
  return {
    version: 1,
    counters: {
      matches: 0,
      wins: 0,
      localMatches: 0,
      captures: 0,
      conversions: 0,
      interceptions: 0,
      transformations: 0,
    },
    unlockedAt: {},
    registeredMatchIds: [],
    processedMatchIds: [],
    processedTacticalEvents: {},
    completedScenarioIds: [],
    goldScenarioIds: [],
  };
}

export function registerAchievementMatch(
  progress: AchievementProgress,
  record: MatchRecord,
): AchievementProgress {
  if (
    progress.registeredMatchIds.includes(record.createdAt) ||
    progress.processedMatchIds.includes(record.createdAt)
  )
    return progress;
  return { ...progress, registeredMatchIds: [...progress.registeredMatchIds, record.createdAt] };
}

/** Called after committing a live order, using its actual engine events and previous state. */
export function evaluateActionAchievements(
  progress: AchievementProgress,
  record: MatchRecord,
  before: GameState,
  events: readonly GameEvent[],
  options: { source: 'live' | 'import' | 'replay'; at: string },
): AchievementUpdate {
  const unchanged = { progress, unlocked: [] };
  if (!canEarnMatchAchievements(progress, record, options.source) || before.outcome)
    return unchanged;
  const humans = humanPlayers(record);
  if (!humans.length) return unchanged;
  const credited = new Set(progress.processedTacticalEvents[record.createdAt] ?? []);
  const previousSize = credited.size;
  const counters = { ...progress.counters };
  collectHumanEvents(counters, before, events, humans, credited);
  if (credited.size === previousSize) return unchanged;
  assertTimestamp(options.at);
  const next = structuredClone(progress);
  next.counters = counters;
  next.processedTacticalEvents[record.createdAt] = [...credited];
  return unlockEligible(next, new Set(), options.at);
}

/** Pure evaluation. Imported records and replay views never award progress. */
export function evaluateMatchAchievements(
  progress: AchievementProgress,
  record: MatchRecord,
  options: { source: 'live' | 'import' | 'replay'; at: string },
): AchievementUpdate {
  const unchanged = { progress, unlocked: [] };
  if (!canEarnMatchAchievements(progress, record, options.source)) return unchanged;

  let finalState: GameState;
  try {
    finalState = replayRecord(record);
  } catch {
    return unchanged;
  }
  if (!finalState.outcome) return unchanged;
  const humans = humanPlayers(record);
  if (!humans.length) return unchanged;
  assertTimestamp(options.at);
  const next = structuredClone(progress);
  next.registeredMatchIds = next.registeredMatchIds.filter((id) => id !== record.createdAt);
  next.processedMatchIds.push(record.createdAt);
  delete next.processedTacticalEvents[record.createdAt];
  next.counters.matches += 1;
  const local = humans.length === 2;
  if (local) next.counters.localMatches += 1;
  const earned = new Set<AchievementId>();
  const outcome = finalState.outcome;
  if (outcome.type === 'win' && humans.includes(outcome.winner)) {
    next.counters.wins += 1;
    const winner = outcome.winner;
    const loser = winner === 0 ? 1 : 0;
    if (local) earned.add('local-win');
    else {
      const difficulty = record.config.participants[loser].difficulty ?? 'recruit';
      const difficultyAchievement: Record<string, AchievementId | undefined> = {
        recruit: 'ai-recruit',
        tactical: 'ai-tactical',
        commander: 'ai-commander',
        expert: 'ai-expert',
      };
      const id = difficultyAchievement[difficulty];
      if (id) earned.add(id);
    }
    const clockAchievement: Record<number, AchievementId | undefined> = {
      300: 'clock-5',
      600: 'clock-10',
      1200: 'clock-20',
    };
    const timedId = clockAchievement[record.config.options.clockSeconds ?? 0];
    if (timedId) earned.add(timedId);
    if (outcome.reason === 'fortress') {
      if (!finalState.pieces.some((piece) => piece.owner === loser)) earned.add('clean-sweep');
      const initialFortress = record.initialState.pieces.find(
        (piece) => piece.owner === winner && piece.type === 'fortress',
      );
      const finalFortress = finalState.pieces.find(
        (piece) => piece.owner === winner && piece.type === 'fortress',
      );
      if (initialFortress?.type === 'fortress' && finalFortress?.type === 'fortress') {
        if (initialFortress.hp === finalFortress.hp) earned.add('untouchable');
        if (
          initialFortress.hp >= 2 &&
          finalFortress.hp === 1 &&
          finalState.firstFortressDamageBy === loser
        )
          earned.add('comeback');
      }
    }
  }
  return unlockEligible(next, earned, options.at);
}

/** Merge saved Academy progress without resetting already earned achievements. */
export function evaluateAcademyAchievements(
  progress: AchievementProgress,
  completedIds: readonly string[],
  goldIds: readonly string[],
  at: string,
): AchievementUpdate {
  assertTimestamp(at);
  const next = structuredClone(progress);
  next.completedScenarioIds = [
    ...new Set([...progress.completedScenarioIds, ...completedIds.filter(isKnownScenario)]),
  ];
  next.goldScenarioIds = [
    ...new Set([
      ...progress.goldScenarioIds,
      ...goldIds.filter((id) => isBuiltInScenario(id) && next.completedScenarioIds.includes(id)),
    ]),
  ];
  const result = unlockEligible(next, new Set(), at);
  if (
    !result.unlocked.length &&
    next.completedScenarioIds.length === progress.completedScenarioIds.length &&
    next.goldScenarioIds.length === progress.goldScenarioIds.length
  )
    return { progress, unlocked: [] };
  return result;
}

export function achievementProgressFor(
  definition: AchievementDefinition,
  progress: AchievementProgress,
): { current: number; target: number; unlocked: boolean; unlockedAt: string | null } {
  const unlockedAt = progress.unlockedAt[definition.id] ?? null;
  let current = unlockedAt ? definition.target : 0;
  if (!unlockedAt && definition.metric) {
    switch (definition.metric) {
      case 'basicScenarios':
        current = BASIC_SCENARIOS.filter(({ id }) =>
          progress.completedScenarioIds.includes(id),
        ).length;
        break;
      case 'academyScenarios':
        current = SCENARIOS.filter(({ id }) => progress.completedScenarioIds.includes(id)).length;
        break;
      case 'dailyScenarios':
        current = progress.completedScenarioIds.filter(isDailyScenario).length;
        break;
      case 'goldScenarios':
        current = progress.goldScenarioIds.length;
        break;
      default:
        current = progress.counters[definition.metric];
    }
  }
  return {
    current: Math.min(definition.target, current),
    target: definition.target,
    unlocked: unlockedAt !== null,
    unlockedAt,
  };
}

export function parseAchievementProgress(raw: string): AchievementProgress {
  const fresh = createAchievementProgress();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fresh;
  }
  if (!isObject(value) || value.version !== 1) return fresh;
  if (isObject(value.counters)) {
    for (const key of Object.keys(fresh.counters) as (keyof AchievementCounters)[]) {
      const count = value.counters[key];
      if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
        fresh.counters[key] = count;
    }
  }
  if (isObject(value.unlockedAt)) {
    for (const { id } of ACHIEVEMENTS) {
      const at = value.unlockedAt[id];
      if (typeof at === 'string' && Number.isFinite(Date.parse(at))) fresh.unlockedAt[id] = at;
    }
  }
  fresh.registeredMatchIds = uniqueStrings(value.registeredMatchIds).filter(isTimestamp);
  fresh.processedMatchIds = uniqueStrings(value.processedMatchIds).filter(isTimestamp);
  if (isObject(value.processedTacticalEvents)) {
    for (const [matchId, events] of Object.entries(value.processedTacticalEvents)) {
      if (isTimestamp(matchId) && !fresh.processedMatchIds.includes(matchId))
        fresh.processedTacticalEvents[matchId] = uniqueStrings(events);
    }
  }
  fresh.completedScenarioIds = uniqueStrings(value.completedScenarioIds).filter(isKnownScenario);
  fresh.goldScenarioIds = uniqueStrings(value.goldScenarioIds).filter(
    (id) => isBuiltInScenario(id) && fresh.completedScenarioIds.includes(id),
  );
  return fresh;
}

export function loadAchievementProgress(): AchievementProgress {
  try {
    return parseAchievementProgress(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return createAchievementProgress();
  }
}

export function saveAchievementProgress(progress: AchievementProgress): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

function unlockEligible(
  progress: AchievementProgress,
  earned: Set<AchievementId>,
  at: string,
): AchievementUpdate {
  const unlocked: AchievementId[] = [];
  for (const definition of ACHIEVEMENTS) {
    if (progress.unlockedAt[definition.id]) continue;
    const value = achievementProgressFor(definition, progress);
    if (earned.has(definition.id) || value.current >= value.target) {
      progress.unlockedAt[definition.id] = at;
      unlocked.push(definition.id);
    }
  }
  return { progress, unlocked };
}

function collectHumanEvents(
  counters: AchievementCounters,
  before: GameState,
  events: readonly GameEvent[],
  humans: readonly Player[],
  credited: Set<string>,
): void {
  const credit = (metric: keyof AchievementCounters, identity: readonly (string | number)[]) => {
    const key = JSON.stringify([metric, ...identity]);
    if (credited.has(key)) return;
    credited.add(key);
    counters[metric] += 1;
  };
  for (const event of events) {
    if (event.owner === undefined || !humans.includes(event.owner)) continue;
    const target = before.pieces.find((piece) => piece.id === event.targetId);
    if (
      (event.type === 'destroy' || event.type === 'intercept') &&
      target &&
      target.type !== 'fortress' &&
      (event.type === 'intercept' || target.owner !== event.owner) &&
      (event.type === 'intercept' || event.pieceId !== event.targetId)
    )
      credit('captures', [target.id]);
    if (event.type === 'convert' && target) credit('conversions', [target.id, event.owner]);
    if (event.type === 'intercept' && target) credit('interceptions', [target.id]);
    if (event.type === 'transform' && event.pieceId) credit('transformations', [event.pieceId]);
  }
}

function canEarnMatchAchievements(
  progress: AchievementProgress,
  record: MatchRecord,
  source: 'live' | 'import' | 'replay',
): boolean {
  return (
    source === 'live' &&
    progress.registeredMatchIds.includes(record.createdAt) &&
    !progress.processedMatchIds.includes(record.createdAt) &&
    ['classic', 'skirmish', 'tactical', 'siege'].includes(record.config.definitionId) &&
    !record.academySession &&
    record.currentAction > 0 &&
    record.currentAction === record.actions.length
  );
}

function humanPlayers(record: MatchRecord): Player[] {
  return ([0, 1] as const).filter((owner) => record.config.participants[owner].kind === 'human');
}

function isBuiltInScenario(id: string): boolean {
  return SCENARIOS.some((scenario) => scenario.id === id);
}
function isDailyScenario(id: string): boolean {
  return /^daily:\d{4}-\d{2}-\d{2}:[a-z0-9]+$/.test(id);
}
function isKnownScenario(id: string): boolean {
  return isBuiltInScenario(id) || isDailyScenario(id);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function uniqueStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0),
        ),
      ]
    : [];
}
function isTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
function assertTimestamp(value: string): void {
  if (!isTimestamp(value)) throw new RangeError('La fecha del logro no es válida.');
}
