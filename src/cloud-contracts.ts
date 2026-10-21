/** Only game saves belong in cloud documents. Auth tokens and telemetry never do. */
export const PLAYER_DATA_KEYS = [
  'hexagonal:user-profile:v1',
  'hexagonal:progression:v1',
  'atlas-achievements-v1',
  'atlas-preferences-v2',
  'atlas-preferences-v1',
  'atlas-pending-matches-v1',
  'atlas-match-classic-v2',
  'atlas-academy-progress-v1',
  'atlas-academy-records-v2',
  'atlas-match-history-v1',
  'atlas-scenario-catalog-v2',
] as const;

export type PlayerDataKey = (typeof PLAYER_DATA_KEYS)[number];
export type PlayerData = Partial<Record<PlayerDataKey, string>>;
export interface CloudSave {
  revision: number;
  data: PlayerData;
  elo: number;
}
export type CloudRequest = { kind: 'load' } | { kind: 'save'; revision: number; data: PlayerData };
