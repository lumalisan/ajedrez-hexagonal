import type { UserProfile } from './user-profile.js';
import type { PlayerProgression, ProgressionMode } from './progression.js';
import type { playerStatistics, playerRecords } from './profile-statistics.js';
export interface PublicPlayerProfile {
  profile: UserProfile;
  progression: Pick<PlayerProgression, 'xp' | 'unlockedAt' | 'activity' | 'ratings'>;
  statistics: Record<ProgressionMode | 'total', ReturnType<typeof playerStatistics>>;
  records: Record<RankingMode, ReturnType<typeof playerRecords>>;
  positions?: Record<RankingMode, number | null>;
}
export type RankingMode = 'machine' | 'online';
export type RankingPeriod = 'all' | 'month';
export interface RankingQuery {
  mode: RankingMode;
  period: RankingPeriod;
  page: number;
}
export interface RankingEntry {
  playerId?: string;
  xp?: number;
  profile?: UserProfile;
  position: number;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  rating: number;
}
export interface RankingPage extends RankingQuery {
  entries: RankingEntry[];
  total: number;
  pageSize: number;
}
export type RankingClient = (query: RankingQuery, signal: AbortSignal) => Promise<RankingPage>;
