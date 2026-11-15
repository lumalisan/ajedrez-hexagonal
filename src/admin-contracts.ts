import type { MatchRecord, Outcome } from './types.js';

export const ADMIN_PERIODS = ['24h', '7d', '14d', '30d', '90d', '365d'] as const;
export type AdminPeriod = (typeof ADMIN_PERIODS)[number];

export interface AdminTraffic {
  start: string;
  end: string;
  previousStart: string;
  firstObservedAt: string | null;
  sessions: number;
  visitors: number;
  previousSessions: number;
  previousVisitors: number;
  buckets: { start: string; end: string; sessions: number }[];
}

export interface AdminUser {
  id: string;
  registeredAt: string;
  name: string;
  email: string;
  matches: number;
  recentVisits: number;
  totalVisits: number;
}

export type AdminUserSort = Exclude<keyof AdminUser, 'id'>;

export interface AdminMatch {
  id: string;
  completedAt: string;
  participants: [string, string];
  outcome: Outcome;
  plies: number;
  durationSeconds: number;
  mode: 'online' | 'machine' | 'local';
  replayAvailable: boolean;
}

export interface AdminPage<T> {
  entries: T[];
  hasMore: boolean;
}

export interface AdminReplay {
  record: MatchRecord;
}
