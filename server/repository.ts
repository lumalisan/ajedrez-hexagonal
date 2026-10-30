import type { PrivateMatchSettings } from '../src/online-contracts.js';
import type { SearchTicket } from '../src/online-matchmaking.js';
import type { MatchRecord } from '../src/types.js';
import type { CloudSave } from '../src/cloud-contracts.js';

export interface OnlinePlayer {
  id: string;
  name: string;
  elo: number;
  played: number;
}
export interface QueueEntry extends SearchTicket {
  seenAt: number;
}
export interface PrivateRoom {
  code: string;
  creatorId: string;
  settings: PrivateMatchSettings;
  expiresAt: number;
}
export interface OnlineMatch {
  id: string;
  players: [string, string];
  record: MatchRecord;
  revision: number;
  ranked: boolean;
  drawOffer?: 0 | 1 | null;
  settled: boolean;
  finishedBy: string[];
  rankingResult?: { completedAt: string; score: 0 | 0.5 | 1; ratingsBefore: [number, number] };
}

export interface OnlineTransaction {
  account(id: string): Promise<Omit<CloudSave, 'elo'> | null>;
  saveAccount(id: string, save: Omit<CloudSave, 'elo'>): Promise<void>;
  player(id: string, lock?: boolean): Promise<OnlinePlayer | null>;
  savePlayer(player: OnlinePlayer): Promise<void>;
  queue(): Promise<QueueEntry[]>;
  saveTicket(ticket: QueueEntry): Promise<void>;
  removeTicket(playerId: string): Promise<void>;
  rooms(): Promise<PrivateRoom[]>;
  saveRoom(room: PrivateRoom): Promise<boolean>;
  removeRoom(code: string): Promise<void>;
  activeMatch(playerId: string): Promise<OnlineMatch | null>;
  match(id: string): Promise<OnlineMatch | null>;
  saveMatch(match: OnlineMatch): Promise<void>;
}

export interface OnlineRepository {
  activeMatchId(playerId: string): Promise<string | null>;
  rankingData(mode: import('../src/ranking-contracts.js').RankingMode): Promise<{
    accounts: Array<{ id: string; profile: string | null; progression: string | null }>;
    players: OnlinePlayer[];
    matches: OnlineMatch[];
  }>;
  transaction<T>(lock: string, work: (tx: OnlineTransaction) => Promise<T>): Promise<T>;
  activeMatches(): Promise<string[]>;
}
