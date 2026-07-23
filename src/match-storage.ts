import { parseRecord, serializeRecord } from './match-record';
import type { GamePreferences, MatchRecord } from './types';

const PREFERENCES_KEY = 'atlas-preferences-v2';
const LEGACY_PREFERENCES_KEY = 'atlas-preferences-v1';
const MATCH_KEY = 'atlas-match-classic-v1';
const PROGRESS_KEY = 'atlas-academy-progress-v1';

export const DEFAULT_PREFERENCES: GamePreferences = {
  sound: true,
  masterVolume: 0.72,
  musicVolume: 0.52,
  effectsVolume: 0.86,
  fixedBoard: true,
  reducedMotion: false,
  highContrast: false,
  confirmation: 'always',
  contextualHints: true,
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

export function saveActiveMatch(record: MatchRecord): void {
  localStorage.setItem(MATCH_KEY, serializeRecord(record));
}

export function loadActiveMatch(): { record: MatchRecord | null; error?: string } {
  const raw = localStorage.getItem(MATCH_KEY);
  if (!raw) return { record: null };
  try {
    return { record: parseRecord(raw) };
  } catch (error) {
    localStorage.removeItem(MATCH_KEY);
    return {
      record: null,
      error: error instanceof Error ? error.message : 'El guardado no se pudo recuperar.',
    };
  }
}

export function clearActiveMatch(): void {
  localStorage.removeItem(MATCH_KEY);
}

export function loadAcademyProgress(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function completeScenario(id: string): void {
  const completed = new Set(loadAcademyProgress());
  completed.add(id);
  localStorage.setItem(PROGRESS_KEY, JSON.stringify([...completed]));
}

export function resetAcademyProgress(): void {
  localStorage.removeItem(PROGRESS_KEY);
}

function clamp(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}
