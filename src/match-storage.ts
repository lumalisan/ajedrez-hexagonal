import {
  concludeMatch,
  matchDurationSeconds,
  parseRecord,
  replayRecord,
  serializeRecord,
} from './match-record';
import type { GamePreferences, MatchRecord, Outcome } from './types';

const PREFERENCES_KEY = 'atlas-preferences-v2';
const LEGACY_PREFERENCES_KEY = 'atlas-preferences-v1';
const PENDING_KEY = 'atlas-pending-matches-v1';
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1_000;
const MATCH_KEY = 'atlas-match-classic-v2';
const PROGRESS_KEY = 'atlas-academy-progress-v1';
const ACADEMY_RECORDS_KEY = 'atlas-academy-records-v2';
const HISTORY_KEY = 'atlas-match-history-v1';

export interface AcademyRecord {
  id: string;
  completed: boolean;
  attempts: number;
  hintsUsed: number;
  bestPlies: number | null;
  medal: 'bronze' | 'silver' | 'gold' | null;
  updatedAt: string;
}

export interface MatchHistoryEntry {
  id: string;
  definitionId: string;
  participants: [string, string];
  outcome: Outcome;
  plies: number;
  durationSeconds: number;
  completedAt: string;
  /** Older history entries contain only a summary. */
  record?: MatchRecord;
}

export const DEFAULT_PREFERENCES: GamePreferences = {
  sound: true,
  masterVolume: 0.72,
  musicVolume: 0.52,
  effectsVolume: 0.86,
  fixedBoard: true,
  boardDepth: false,
  reducedMotion: false,
  idleAnimations: false,
  highContrast: false,
  confirmation: 'always',
  contextualHints: true,
  tacticalThreats: false,
  handoffScreen: false,
};

export function loadPreferences(): GamePreferences {
  try {
    const raw =
      localStorage.getItem(PREFERENCES_KEY) ?? localStorage.getItem(LEGACY_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const value = JSON.parse(raw) as Partial<GamePreferences>;
    return {
      ...DEFAULT_PREFERENCES,
      ...value,
      idleAnimations: value.idleAnimations === true,
      masterVolume: clamp(value.masterVolume, DEFAULT_PREFERENCES.masterVolume),
      musicVolume: clamp(value.musicVolume, DEFAULT_PREFERENCES.musicVolume),
      effectsVolume: clamp(value.effectsVolume, DEFAULT_PREFERENCES.effectsVolume),
      confirmation: ['always', 'critical', 'quick'].includes(value.confirmation ?? '')
        ? value.confirmation!
        : 'always',
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences: GamePreferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    localStorage.setItem(LEGACY_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences remain active in memory when storage is unavailable.
  }
}

export function saveActiveMatch(record: MatchRecord): boolean {
  const serialized = serializeRecord(record);
  const pending = readPendingMatches();
  const activeSaved = safeSetItem(MATCH_KEY, serialized);
  if (record.config.definitionId.startsWith('scenario:')) return activeSaved;
  const previous = pending.find((entry) => entry.record.createdAt === record.createdAt);
  const remaining = pending.filter((entry) => entry.record.createdAt !== record.createdAt);
  if (!replayRecord(record).outcome)
    remaining.unshift({ record, resumedAt: previous?.resumedAt ?? new Date().toISOString() });
  return safeSetItem(PENDING_KEY, JSON.stringify(remaining)) && activeSaved;
}

export function loadActiveMatch(): { record: MatchRecord | null; error?: string } {
  try {
    const raw = localStorage.getItem(MATCH_KEY);
    if (!raw) return { record: null };
    return { record: parseRecord(raw) };
  } catch (error) {
    safeRemoveItem(MATCH_KEY);
    return {
      record: null,
      error: error instanceof Error ? error.message : 'El guardado no se pudo recuperar.',
    };
  }
}

export function clearActiveMatch(): boolean {
  return safeRemoveItem(MATCH_KEY);
}

export interface PendingMatch {
  record: MatchRecord;
  resumedAt: string;
}

function readPendingMatches(): PendingMatch[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw === null) {
      const legacy = loadActiveMatch().record;
      if (
        legacy &&
        !legacy.config.definitionId.startsWith('scenario:') &&
        !replayRecord(legacy).outcome
      ) {
        const migrated = [{ record: legacy, resumedAt: legacy.updatedAt }];
        safeSetItem(PENDING_KEY, JSON.stringify(migrated));
        return migrated;
      }
      return [];
    }
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry: unknown) => {
      try {
        if (
          !entry ||
          typeof entry !== 'object' ||
          !('record' in entry) ||
          !('resumedAt' in entry) ||
          typeof entry.resumedAt !== 'string' ||
          !Number.isFinite(Date.parse(entry.resumedAt))
        )
          return [];
        const record = parseRecord(JSON.stringify(entry.record));
        if (record.config.definitionId.startsWith('scenario:') || replayRecord(record).outcome)
          return [];
        return [{ record, resumedAt: entry.resumedAt }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function loadPendingMatches(now = Date.now()): PendingMatch[] {
  const pending = readPendingMatches();
  const remaining: PendingMatch[] = [];
  for (const entry of pending) {
    if (now - Date.parse(entry.resumedAt) <= THIRTY_DAYS) {
      remaining.push(entry);
      continue;
    }
    const { record } = entry;
    const human = record.config.participants.findIndex((p) => p.kind === 'human');
    const loser =
      record.config.participants.some((p) => p.kind === 'machine') && human >= 0 ? human : 0;
    const outcome: Outcome = { type: 'win', winner: loser === 0 ? 1 : 0, reason: 'resignation' };
    const concluded = concludeMatch(record, outcome);
    const completedAt = new Date(now).toISOString();
    const history = loadMatchHistory().filter((candidate) => candidate.id !== record.createdAt);
    const result: MatchHistoryEntry = {
      id: record.createdAt,
      definitionId: record.config.definitionId,
      participants: [record.config.participants[0].name, record.config.participants[1].name],
      outcome,
      plies: record.currentAction,
      durationSeconds: matchDurationSeconds(record),
      completedAt,
      record: concluded,
    };
    if (!safeSetItem(HISTORY_KEY, JSON.stringify([result, ...history].slice(0, 30)))) {
      remaining.push(entry);
      continue;
    }
    if (loadActiveMatch().record?.createdAt === record.createdAt) clearActiveMatch();
  }
  if (remaining.length !== pending.length) safeSetItem(PENDING_KEY, JSON.stringify(remaining));
  return remaining.sort((a, b) => Date.parse(b.resumedAt) - Date.parse(a.resumedAt));
}

export function resumePendingMatch(id: string): MatchRecord | null {
  const pending = loadPendingMatches();
  const entry = pending.find((candidate) => candidate.record.createdAt === id);
  if (!entry) return null;
  entry.resumedAt = new Date().toISOString();
  safeSetItem(PENDING_KEY, JSON.stringify(pending));
  return entry.record;
}

export function loadAcademyProgress(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function completeScenario(id: string): boolean {
  const completed = new Set(loadAcademyProgress());
  completed.add(id);
  return safeSetItem(PROGRESS_KEY, JSON.stringify([...completed]));
}

export function loadAcademyRecords(): AcademyRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACADEMY_RECORDS_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is AcademyRecord =>
            Boolean(entry) &&
            typeof entry === 'object' &&
            typeof (entry as AcademyRecord).id === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

export function recordScenarioAttempt(
  id: string,
  result: { completed: boolean; plies: number; hintsUsed: number; parPlies?: number },
): AcademyRecord {
  const records = loadAcademyRecords();
  const previous = records.find((entry) => entry.id === id);
  const bestPlies = result.completed
    ? Math.min(previous?.bestPlies ?? Number.POSITIVE_INFINITY, result.plies)
    : (previous?.bestPlies ?? null);
  const earnedMedal = result.completed
    ? result.hintsUsed === 0 && result.plies <= (result.parPlies ?? 3)
      ? 'gold'
      : result.hintsUsed <= 1
        ? 'silver'
        : 'bronze'
    : null;
  const medal = bestMedal(previous?.medal ?? null, earnedMedal);
  const next: AcademyRecord = {
    id,
    completed: Boolean(previous?.completed || result.completed),
    attempts: (previous?.attempts ?? 0) + 1,
    hintsUsed: (previous?.hintsUsed ?? 0) + result.hintsUsed,
    bestPlies: Number.isFinite(bestPlies) ? bestPlies : null,
    medal,
    updatedAt: new Date().toISOString(),
  };
  const updated = [...records.filter((entry) => entry.id !== id), next];
  safeSetItem(ACADEMY_RECORDS_KEY, JSON.stringify(updated));
  if (result.completed) completeScenario(id);
  return next;
}

function bestMedal(
  current: AcademyRecord['medal'],
  earned: AcademyRecord['medal'],
): AcademyRecord['medal'] {
  const rank: Record<Exclude<AcademyRecord['medal'], null>, number> = {
    bronze: 1,
    silver: 2,
    gold: 3,
  };
  if (!current) return earned;
  if (!earned) return current;
  return rank[earned] > rank[current] ? earned : current;
}

export function loadMatchHistory(): MatchHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as MatchHistoryEntry[]).slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function appendMatchHistory(entry: MatchHistoryEntry): MatchHistoryEntry {
  const current = loadMatchHistory().filter((candidate) => candidate.id !== entry.id);
  safeSetItem(HISTORY_KEY, JSON.stringify([entry, ...current].slice(0, 30)));
  return entry;
}

export function removeMatchHistory(id: string): boolean {
  const current = loadMatchHistory().filter((entry) => entry.id !== id);
  return safeSetItem(HISTORY_KEY, JSON.stringify(current));
}

export function resetAcademyProgress(): void {
  safeRemoveItem(PROGRESS_KEY);
  safeRemoveItem(ACADEMY_RECORDS_KEY);
}

function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveItem(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function clamp(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}
