import { applyAction } from './engine';
import { equalHex, hexDistance } from './hex';
import { replayRecord, resolutionRulesForConfig } from './match-record';
import { PROGRESSION_ACHIEVEMENTS } from './progression-catalog';
import type { AchievementProgress } from './achievements';
import type { AiDifficulty, MatchRecord, PieceType, Player } from './types';

export { PROGRESSION_ACHIEVEMENTS };
export type ProgressionAchievement = (typeof PROGRESSION_ACHIEVEMENTS)[number];
export type ProgressionAchievementId = ProgressionAchievement['id'];
export type ProgressionMode = 'local' | 'machine' | 'online';
export const TIERS = [
  { name: 'Principiante', level: 1, xp: 50 },
  { name: 'Avanzado', level: 5, xp: 100 },
  { name: 'Experto', level: 15, xp: 250 },
  { name: 'Maestro', level: 30, xp: 500 },
  { name: 'Legendario', level: 50, xp: 1000 },
] as const;
export const AI_RATINGS: Record<AiDifficulty, number> = {
  recruit: 600,
  tactical: 1000,
  commander: 1400,
  expert: 1800,
};
const DIFFICULTIES: AiDifficulty[] = ['recruit', 'tactical', 'commander', 'expert'];
const STORAGE_KEY = 'hexagonal:progression:v1';
const COMBAT_TYPES: PieceType[] = [
  'soldier',
  'capturer',
  'medium',
  'long',
  'fast',
  'drone',
  'airplane',
];
type Metrics = Record<string, number>;
export interface MatchEvidence {
  mode: ProgressionMode;
  difficulty: number;
  metrics: Metrics;
  completedAt?: string;
  result?: 0 | 0.5 | 1;
  opponentRating?: number;
}
export interface PlayerProgression {
  version: 1;
  xp: number;
  unlockedAt: Partial<Record<ProgressionAchievementId, string>>;
  registeredMatchIds: string[];
  matches: Record<string, MatchEvidence>;
  activity: { lastDay: string | null; streak: number; best: number };
  lastDailyMatch: string | null;
  tutorial: boolean;
  storyChapters: string[];
  story: boolean;
  ratings: { machine: number; online: number };
  /** Legacy unlocks are retained without inventing mode or difficulty evidence. */
  legacyUnlockedAt: Record<string, string>;
}
export interface ProgressionUpdate {
  progress: PlayerProgression;
  unlocked: ProgressionAchievementId[];
  xpEarned: number;
}

export function createPlayerProgression(): PlayerProgression {
  return {
    version: 1,
    xp: 0,
    unlockedAt: {},
    registeredMatchIds: [],
    matches: {},
    activity: { lastDay: null, streak: 0, best: 0 },
    lastDailyMatch: null,
    tutorial: false,
    storyChapters: [],
    story: false,
    ratings: { machine: 1000, online: 1000 },
    legacyUnlockedAt: {},
  };
}

export function xpForLevel(level: number): number {
  const steps = Math.max(0, Math.min(100, Math.floor(level)) - 1);
  return 100 * steps + (25 * steps * (steps + 1)) / 2;
}
export function levelProgress(xp: number) {
  let level = 1;
  while (level < 100 && xp >= xpForLevel(level + 1)) level++;
  let tier = 0;
  TIERS.forEach((entry, index) => {
    if (level >= entry.level) tier = index;
  });
  const current = Math.max(0, xp - xpForLevel(level));
  return {
    level,
    tier,
    category: TIERS[tier].name,
    current,
    required: level === 100 ? 0 : 100 + 25 * level,
  };
}
export function eloK(matches: number): number {
  return matches < 10 ? 40 : matches < 25 ? 32 : matches < 50 ? 24 : matches < 100 ? 20 : 16;
}
export function calculateElo(
  rating: number,
  opponent: number,
  result: number,
  matches: number,
): number {
  return Math.max(
    0,
    Math.round(rating + eloK(matches) * (result - 1 / (1 + 10 ** ((opponent - rating) / 400)))),
  );
}
/** Calendar days in the player's local timezone, rather than UTC midnight. */
export function localDay(at: string): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Fecha de progreso inválida.');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function eligibleFacts(
  progress: PlayerProgression,
  definition: ProgressionAchievement,
): MatchEvidence[] {
  const modes: readonly string[] = definition.modes;
  return Object.values(progress.matches).filter(
    (match) =>
      modes.includes(match.mode) &&
      (match.mode !== 'machine' || match.difficulty >= definition.minDifficulty),
  );
}
const MAX_METRICS = new Set([
  'ramDistance',
  'unitKills',
  'airKillsMatch',
  'soldierKills',
  'tankKills',
  'conversionsMatch',
  'stationaryMissileKills',
  'planeKills',
  'ramAttackDistance',
  'ratingGap',
]);
export function progressionValue(
  progress: PlayerProgression,
  definition: ProgressionAchievement,
): number {
  switch (definition.metric) {
    case 'tutorial':
      return Number(progress.tutorial);
    case 'story':
      return Number(progress.story);
    case 'activity':
      return progress.activity.best;
    case 'level':
      return levelProgress(progress.xp).level;
    case 'onlineRating':
      return progress.ratings.online;
    // A position needs a real shared leaderboard; a device with one profile has no world rank.
    case 'historicalRank':
    case 'monthlyRank':
      return 0;
    case 'winStreak': {
      let streak = 0,
        best = 0;
      for (const match of eligibleFacts(progress, definition)
        .filter((m) => m.completedAt)
        .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!))) {
        streak = match.result === 1 ? streak + 1 : 0;
        best = Math.max(best, streak);
      }
      return best;
    }
    default: {
      const values = eligibleFacts(progress, definition).map(
        (match) => match.metrics[definition.metric] ?? 0,
      );
      return MAX_METRICS.has(definition.metric)
        ? Math.max(0, ...values)
        : values.reduce((sum, value) => sum + value, 0);
    }
  }
}
/** Iterate because achievement XP can open a new tier with already satisfied achievements. */
function unlock(progress: PlayerProgression, at: string, previousXp: number): ProgressionUpdate {
  localDay(at);
  const unlocked: ProgressionAchievementId[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    const tier = levelProgress(progress.xp).tier;
    for (const entry of PROGRESSION_ACHIEVEMENTS) {
      if (
        entry.tier > tier ||
        progress.unlockedAt[entry.id] ||
        progressionValue(progress, entry) < entry.target
      )
        continue;
      progress.unlockedAt[entry.id] = at;
      progress.xp += TIERS[entry.tier].xp;
      unlocked.push(entry.id);
      changed = true;
    }
  }
  return { progress, unlocked, xpEarned: progress.xp - previousXp };
}
export function recordActivity(progress: PlayerProgression, at: string): ProgressionUpdate {
  const day = localDay(at);
  if (progress.activity.lastDay === day) return unchanged(progress);
  const next = structuredClone(progress);
  const previous = progress.activity.lastDay;
  // UTC conversion of calendar labels avoids DST changing a day's length.
  const consecutive = previous && Date.parse(day) - Date.parse(previous) === 86_400_000;
  next.activity = {
    lastDay: day,
    streak: consecutive ? progress.activity.streak + 1 : 1,
    best: Math.max(progress.activity.best, consecutive ? progress.activity.streak + 1 : 1),
  };
  return unlock(next, at, progress.xp);
}
export function recordLearning(
  progress: PlayerProgression,
  kind: 'tutorial' | 'story',
  at: string,
  chapter?: string,
  chapterIds: readonly string[] = [],
): ProgressionUpdate {
  const next = structuredClone(progress);
  if (kind === 'tutorial') next.tutorial = true;
  else {
    if (chapter && chapterIds.includes(chapter) && !next.storyChapters.includes(chapter))
      next.storyChapters.push(chapter);
    next.story = chapterIds.length > 0 && chapterIds.every((id) => next.storyChapters.includes(id));
  }
  return unlock(next, at, progress.xp);
}
export function registerProgressionMatch(
  progress: PlayerProgression,
  record: MatchRecord,
): PlayerProgression {
  if (
    progress.registeredMatchIds.includes(record.createdAt) ||
    progress.matches[record.createdAt]?.completedAt
  )
    return progress;
  return { ...progress, registeredMatchIds: [...progress.registeredMatchIds, record.createdAt] };
}
function unchanged(progress: PlayerProgression): ProgressionUpdate {
  return { progress, unlocked: [], xpEarned: 0 };
}

/** Reconstruct facts exclusively through legal engine actions. Only Cian belongs to the local profile. */
export function evaluateProgressionMatch(
  progress: PlayerProgression,
  record: MatchRecord,
  options: { source: 'live' | 'import' | 'replay'; at: string },
): ProgressionUpdate {
  if (
    options.source !== 'live' ||
    !progress.registeredMatchIds.includes(record.createdAt) ||
    progress.matches[record.createdAt]?.completedAt ||
    record.academySession ||
    !['classic', 'skirmish', 'tactical', 'siege'].includes(record.config.definitionId) ||
    record.currentAction !== record.actions.length
  )
    return unchanged(progress);
  let final;
  try {
    final = replayRecord(record);
  } catch {
    return unchanged(progress);
  }
  const machineIndex = record.config.participants.findIndex((p) => p.kind === 'machine');
  const owner: Player = machineIndex === 0 ? 1 : 0;
  if (record.config.participants[owner].kind !== 'human') return unchanged(progress);
  const mode = machineIndex === -1 ? 'local' : 'machine';
  const difficulty =
    machineIndex === -1
      ? 0
      : DIFFICULTIES.indexOf(record.config.participants[machineIndex].difficulty ?? 'recruit');
  const metrics = analyzeRecord(record, owner);
  const next = structuredClone(progress);
  const prior = next.matches[record.createdAt];
  const evidence: MatchEvidence = { mode, difficulty, metrics: { ...prior?.metrics } };
  for (const [key, value] of Object.entries(metrics))
    evidence.metrics[key] = Math.max(evidence.metrics[key] ?? 0, value);
  next.matches[record.createdAt] = evidence;
  if (final.outcome) {
    const day = localDay(options.at);
    const win = final.outcome.type === 'win' && final.outcome.winner === owner;
    const result = final.outcome.type === 'draw' ? 0.5 : win ? 1 : 0;
    evidence.completedAt = options.at;
    evidence.result = result;
    next.registeredMatchIds = next.registeredMatchIds.filter((id) => id !== record.createdAt);
    addCompletionMetrics(evidence.metrics, record, final, owner, win, day);
    const duration = Math.min(50, Math.floor((final.ply - record.initialState.ply) / 2));
    const base = mode === 'local' ? 0 : (win ? [50, 75, 100, 150] : [25, 35, 50, 75])[difficulty];
    next.xp += base + Math.max(0, duration);
    if (progress.lastDailyMatch !== day) {
      next.xp += 25;
      next.lastDailyMatch = day;
    }
    if (mode === 'machine') {
      evidence.opponentRating = AI_RATINGS[DIFFICULTIES[difficulty]];
      const played = Object.values(progress.matches).filter(
        (m) => m.mode === 'machine' && m.completedAt,
      ).length;
      next.ratings.machine = calculateElo(
        progress.ratings.machine,
        evidence.opponentRating,
        result,
        played,
      );
    }
  }
  return unlock(next, options.at, progress.xp);
}

function analyzeRecord(record: MatchRecord, owner: Player): Metrics {
  let state = structuredClone(record.initialState);
  const metrics: Metrics = {};
  const killsByUnit: Metrics = {};
  const stationary: Metrics = {};
  const missilesUsed: Metrics = {};
  const used = new Set<PieceType>(),
    killedWith = new Set<PieceType>();
  const converted = new Set<string>(),
    exhausted = new Set<string>();
  const bump = (key: string, count = 1) => {
    metrics[key] = (metrics[key] ?? 0) + count;
  };
  const max = (key: string, count: number) => {
    metrics[key] = Math.max(metrics[key] ?? 0, count);
  };
  for (const action of record.actions) {
    const actor = state.pieces.find((piece) => piece.id === action.pieceId);
    const result = applyAction(state, action, resolutionRulesForConfig(record.config));
    if (!result.ok) break;
    const own = actor?.owner === owner;
    const combatType = action.kind === 'transform' ? 'soldier' : actor?.type;
    if (actor?.type === 'long' && action.kind === 'move') stationary[actor.id] = 0;
    const target =
      'targetId' in action ? state.pieces.find((p) => p.id === action.targetId) : undefined;
    if (own && actor) {
      used.add(actor.type);
      if (action.kind === 'transform') used.add('soldier');
      if (action.kind === 'rotate' && actor.type === 'soldier') bump('rotate');
      if (action.kind === 'orient' && actor.type === 'medium') bump('orient');
      if (action.kind === 'transform') bump('transform');
      if (action.kind === 'convert') {
        bump('conversions');
        converted.add(action.targetId);
      }
      if (action.kind === 'move') {
        const distance = hexDistance(actor.position, action.to);
        if (actor.type === 'fast') {
          max('ramDistance', distance);
          if (target && target.owner !== owner) max('ramAttackDistance', distance);
        }
        if (action.kamikaze) bump('kamikaze');
        const afterActor = result.state.pieces.find((p) => p.id === actor.id);
        if (
          actor.type === 'drone' &&
          afterActor &&
          state.pieces.some(
            (p) =>
              p.id !== actor.id &&
              p.owner === owner &&
              !equalHex(p.position, actor.position) &&
              !equalHex(p.position, afterActor.position) &&
              hexDistance(actor.position, p.position) +
                hexDistance(p.position, afterActor.position) ===
                hexDistance(actor.position, afterActor.position),
          )
        )
          bump('flyAlly');
        if (
          actor.type === 'airplane' &&
          afterActor &&
          result.state.pieces.some(
            (p) => p.owner !== owner && equalHex(p.position, afterActor.position),
          )
        )
          bump('aboveEnemy');
      }
      const attacked =
        target ??
        result.events
          .filter((e) => e.type === 'destroy' || e.type === 'fortressDamage')
          .map((e) => state.pieces.find((p) => p.id === e.targetId))
          .find((p) => p && p.owner !== owner);
      if (attacked) {
        if (actor.type === 'fast' && attacked.type === 'fast') bump('ramEnemy');
        if (actor.type === 'fast')
          max('ramAttackDistance', hexDistance(actor.position, attacked.position));
        if (converted.has(actor.id)) bump('capturedAttack');
        if (
          state.pieces.filter((p) => p.owner !== owner && equalHex(p.position, attacked.position))
            .length === 2
        )
          bump('stackAttack');
      }
      const afterActor = result.state.pieces.find((p) => p.id === actor.id);
      if (
        actor.type === 'long' &&
        action.kind === 'shoot' &&
        afterActor?.type === 'long' &&
        afterActor.missilesRemaining === 0
      ) {
        metrics.emptyMissiles = 1;
      }
      if (actor.type === 'long' && action.kind === 'shoot') {
        missilesUsed[actor.id] = (missilesUsed[actor.id] ?? 0) + 1;
        if (missilesUsed[actor.id] >= 2) exhausted.add(actor.id);
      }
    }
    for (const event of result.events) {
      const victim = state.pieces.find((p) => p.id === event.targetId);
      if (
        event.owner !== owner ||
        !victim ||
        victim.owner === owner ||
        (event.type !== 'intercept' && event.pieceId === event.targetId)
      )
        continue;
      if (event.type === 'destroy' || event.type === 'intercept') {
        if (victim.type !== 'fortress') {
          bump('kills');
          if (
            own &&
            actor &&
            combatType &&
            event.type !== 'intercept' &&
            event.pieceId === actor.id
          ) {
            killedWith.add(combatType);
            killsByUnit[actor.id] = (killsByUnit[actor.id] ?? 0) + 1;
            max('unitKills', killsByUnit[actor.id]);
            bump(action.kind === 'shoot' ? 'rangedKills' : 'meleeKills');
            if (combatType === 'soldier') bump('soldierKills');
            if (combatType === 'airplane') bump('planeKills');
            if (combatType === 'long' && action.kind === 'shoot') {
              stationary[actor.id] = (stationary[actor.id] ?? 0) + 1;
              max('stationaryMissileKills', stationary[actor.id]);
            }
            if (
              ['drone', 'airplane'].includes(victim.type) &&
              ['drone', 'airplane'].includes(combatType)
            )
              bump('airByAirKills');
          }
          if (['drone', 'airplane'].includes(victim.type)) bump('airKillsMatch');
          if (victim.type === 'medium') bump('tankKills');
        } else if (own && actor) {
          if (
            victim.hp === 1 &&
            record.initialState.pieces.some(
              (p) => p.id === victim.id && p.type === 'fortress' && p.hp === 3,
            )
          )
            metrics.fortressThree = 1;
          if (converted.has(actor.id)) metrics.capturedFinish = 1;
          if (exhausted.has(actor.id) && combatType === 'soldier') metrics.missileSoldierFinish = 1;
          if (action.kind === 'move' && action.kamikaze) metrics.kamikazeWins = 1;
        }
      }
    }
    state = result.state;
  }
  metrics.conversionsMatch = metrics.conversions ?? 0;
  metrics.allTypesUsed = Number(COMBAT_TYPES.every((type) => used.has(type)));
  metrics.allTypesKill = Number(COMBAT_TYPES.every((type) => killedWith.has(type)));
  return metrics;
}

function addCompletionMetrics(
  metrics: Metrics,
  record: MatchRecord,
  final: ReturnType<typeof replayRecord>,
  owner: Player,
  win: boolean,
  day: string,
) {
  const turns = final.ply - record.initialState.ply;
  const initialOwn = record.initialState.pieces.filter((p) => p.owner === owner);
  const survivingIds = new Set(final.pieces.filter((p) => p.owner === owner).map((p) => p.id));
  const survivors = initialOwn.filter((p) => survivingIds.has(p.id)).length;
  const ownFortress = initialOwn.find((p) => p.type === 'fortress');
  const finalFortress = final.pieces.find((p) => p.owner === owner && p.type === 'fortress');
  const damage =
    ownFortress?.type === 'fortress' && finalFortress?.type === 'fortress'
      ? ownFortress.hp - finalFortress.hp
      : 0;
  metrics.matches = 1;
  metrics.wins = Number(win);
  metrics.longMatches = Number(turns >= 50);
  metrics.longWins = Number(win && turns >= 50);
  metrics.quickWins = Number(win && turns < 40);
  metrics.timedWins = Number(win && record.config.options.clockSeconds !== null);
  metrics.blitzWins = Number(win && record.config.options.clockSeconds === 300);
  metrics.cleanWins = Number(win && !final.pieces.some((p) => p.owner !== owner));
  metrics.lastSurvivorWins = Number(
    win && final.pieces.filter((p) => p.owner === owner && p.type !== 'fortress').length === 1,
  );
  metrics.damagedOneWins = Number(win && damage >= 1);
  metrics.damagedTwoWins = Number(win && damage >= 2);
  metrics.noLossWin = Number(
    win && final.outcome?.reason === 'fortress' && survivors === initialOwn.length,
  );
  metrics.halfSurvivors = Number(win && survivors >= initialOwn.length * 0.5);
  metrics.threeQuarterSurvivors = Number(win && survivors >= initialOwn.length * 0.75);
  metrics.halfEnemies = Number(
    (metrics.kills ?? 0) >=
      record.initialState.pieces.filter((p) => p.owner !== owner).length * 0.5,
  );
  const shields = initialOwn.filter((p) => p.type === 'antiAir');
  metrics.shieldSurvived = Number(
    shields.length > 0 && shields.every((p) => survivingIds.has(p.id)),
  );
  metrics.year2488 = Number(day.startsWith('2488-'));
}

export function rankingSummary(
  progress: PlayerProgression,
  mode: 'machine' | 'online',
  period: 'all' | 'month',
  at: string,
) {
  const today = localDay(at);
  const since = new Date(Date.parse(today) - 29 * 86_400_000).toISOString().slice(0, 10);
  const matches = Object.values(progress.matches)
    .filter(
      (m) =>
        m.mode === mode &&
        m.completedAt &&
        (period === 'all' ||
          (localDay(m.completedAt) >= since && localDay(m.completedAt) <= today)),
    )
    .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!));
  let monthlyRating = 1000;
  matches.forEach((match, index) => {
    monthlyRating = calculateElo(
      monthlyRating,
      match.opponentRating ?? 1000,
      match.result ?? 0.5,
      index,
    );
  });
  return {
    played: matches.length,
    wins: matches.filter((m) => m.result === 1).length,
    draws: matches.filter((m) => m.result === 0.5).length,
    losses: matches.filter((m) => m.result === 0).length,
    rating: period === 'all' ? progress.ratings[mode] : monthlyRating,
  };
}

export function migrateProgression(legacy: AchievementProgress): PlayerProgression {
  const fresh = createPlayerProgression();
  fresh.legacyUnlockedAt = { ...legacy.unlockedAt };
  // Only evidence with identical semantics is reusable. Old local counters counted both players.
  if (legacy.unlockedAt['tutorial-complete']) fresh.tutorial = true;
  fresh.registeredMatchIds = [...legacy.registeredMatchIds];
  for (const id of legacy.processedMatchIds)
    fresh.matches[id] = { mode: 'local', difficulty: 0, metrics: {}, completedAt: id };
  return fresh;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function count(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((v): v is string => typeof v === 'string'))]
    : [];
}
export function parsePlayerProgression(raw: string): PlayerProgression {
  const fresh = createPlayerProgression();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fresh;
  }
  if (!object(value) || value.version !== 1) return fresh;
  fresh.xp = count(value.xp);
  if (object(value.unlockedAt))
    for (const entry of PROGRESSION_ACHIEVEMENTS) {
      const at = value.unlockedAt[entry.id];
      if (timestamp(at)) fresh.unlockedAt[entry.id] = at;
    }
  if (object(value.matches))
    for (const [id, match] of Object.entries(value.matches)) {
      if (
        !timestamp(id) ||
        !object(match) ||
        !['local', 'machine', 'online'].includes(String(match.mode)) ||
        !object(match.metrics)
      )
        continue;
      const metrics: Metrics = {};
      for (const [key, metric] of Object.entries(match.metrics))
        if (count(metric, -1) >= 0) metrics[key] = count(metric);
      fresh.matches[id] = {
        mode: match.mode as ProgressionMode,
        difficulty: Math.min(3, count(match.difficulty)),
        metrics,
        ...(timestamp(match.completedAt) ? { completedAt: match.completedAt } : {}),
        ...(match.result === 0 || match.result === 0.5 || match.result === 1
          ? { result: match.result }
          : {}),
        ...(count(match.opponentRating, -1) >= 0
          ? { opponentRating: count(match.opponentRating) }
          : {}),
      };
    }
  fresh.registeredMatchIds = strings(value.registeredMatchIds).filter(
    (id) => timestamp(id) && !fresh.matches[id]?.completedAt,
  );
  if (object(value.ratings))
    fresh.ratings = {
      machine: count(value.ratings.machine, 1000),
      online: count(value.ratings.online, 1000),
    };
  if (object(value.activity))
    fresh.activity = {
      lastDay:
        typeof value.activity.lastDay === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.activity.lastDay)
          ? value.activity.lastDay
          : null,
      streak: count(value.activity.streak),
      best: count(value.activity.best),
    };
  fresh.lastDailyMatch =
    typeof value.lastDailyMatch === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.lastDailyMatch)
      ? value.lastDailyMatch
      : null;
  fresh.tutorial = value.tutorial === true;
  fresh.story = value.story === true;
  fresh.storyChapters = strings(value.storyChapters);
  if (object(value.legacyUnlockedAt))
    for (const [id, at] of Object.entries(value.legacyUnlockedAt))
      if (timestamp(at)) fresh.legacyUnlockedAt[id] = at;
  return fresh;
}
export function loadPlayerProgression(legacy: AchievementProgress): PlayerProgression {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? migrateProgression(legacy) : parsePlayerProgression(raw);
  } catch {
    return migrateProgression(legacy);
  }
}
export function savePlayerProgression(progress: PlayerProgression): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
