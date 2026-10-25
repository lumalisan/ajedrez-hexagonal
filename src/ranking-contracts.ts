export type RankingMode = 'machine' | 'online';
export type RankingPeriod = 'all' | 'month';
export interface RankingQuery {
  mode: RankingMode;
  period: RankingPeriod;
  page: number;
}
export interface RankingEntry {
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
