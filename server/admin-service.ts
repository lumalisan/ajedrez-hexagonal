import type { Pool } from 'pg';
import {
  ADMIN_PERIODS,
  type AdminMatch,
  type AdminPeriod,
  type AdminTraffic,
  type AdminUser,
  type AdminUserSort,
} from '../src/admin-contracts.js';
import { matchDurationSeconds, parseRecord, replayRecord } from '../src/match-record.js';
import type { MatchHistoryEntry } from '../src/match-storage.js';
import type { MatchRecord } from '../src/types.js';
import { OnlineError } from './online-service.js';

const HOUR = 3_600_000;
const PAGE_SIZE = 50;
const durations: Record<AdminPeriod, number> = {
  '24h': 24,
  '7d': 7 * 24,
  '14d': 14 * 24,
  '30d': 30 * 24,
  '90d': 90 * 24,
  '365d': 365 * 24,
};
const userColumns = {
  registeredAt: 'u.registered_at',
  name: 'lower(u.name)',
  email: 'lower(u.email)',
  matches: 'matches',
  recentVisits: '"recentVisits"',
  totalVisits: '"totalVisits"',
} satisfies Record<AdminUserSort, string>;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
}

function pageOffset(page: string) {
  if (!/^\d+$/.test(page) || !Number.isSafeInteger(Number(page) * PAGE_SIZE))
    throw new OnlineError('Página no válida.');
  return Number(page) * PAGE_SIZE;
}

export class AdminService {
  constructor(
    private readonly pool: Pool,
    private readonly now = Date.now,
  ) {}

  async visit(id: unknown, visitorId: unknown, userId: string | null) {
    if (!isUuid(id) || !isUuid(visitorId)) throw new OnlineError('Sesión de visita no válida.');
    await this.pool.query(
      `insert into hexfortia.site_sessions as s (id, visitor_id, user_id) values ($1, $2, $3)
       on conflict (id) do update set user_id = excluded.user_id
       where s.visitor_id = excluded.visitor_id and s.user_id is null and excluded.user_id is not null`,
      [id, visitorId, userId],
    );
  }

  async traffic(period: string): Promise<AdminTraffic> {
    if (!(ADMIN_PERIODS as readonly string[]).includes(period))
      throw new OnlineError('Período no válido.');
    const hours = durations[period as AdminPeriod];
    const end = this.now();
    const start = end - hours * HOUR;
    const previousStart = start - hours * HOUR;
    const bucketHours = period === '24h' ? 1 : 24;
    const bucketSeconds = bucketHours * 3600;
    const iso = (time: number) => new Date(time).toISOString();
    const [totals, series, first] = await Promise.all([
      this.pool.query<
        Pick<AdminTraffic, 'sessions' | 'visitors' | 'previousSessions' | 'previousVisitors'>
      >(
        `select count(*) filter (where started_at >= $1)::int as sessions,
                count(distinct visitor_id) filter (where started_at >= $1)::int as visitors,
                count(*) filter (where started_at < $1)::int as "previousSessions",
                count(distinct visitor_id) filter (where started_at < $1)::int as "previousVisitors"
         from hexfortia.site_sessions where started_at >= $2 and started_at < $3`,
        [iso(start), iso(previousStart), iso(end)],
      ),
      this.pool.query<{ bucket: number; sessions: number }>(
        `select floor(extract(epoch from (started_at - $1::timestamptz)) / $3)::int as bucket,
                count(*)::int as sessions
         from hexfortia.site_sessions where started_at >= $1 and started_at < $2 group by 1`,
        [iso(start), iso(end), bucketSeconds],
      ),
      this.pool.query<{ firstObservedAt: string | null }>(
        'select min(started_at) as "firstObservedAt" from hexfortia.site_sessions',
      ),
    ]);
    const counts = new Map(series.rows.map((row) => [row.bucket, row.sessions]));
    return {
      ...totals.rows[0]!,
      ...first.rows[0]!,
      start: iso(start),
      end: iso(end),
      previousStart: iso(previousStart),
      buckets: Array.from({ length: hours / bucketHours }, (_, index) => ({
        start: iso(start + index * bucketHours * HOUR),
        end: iso(start + (index + 1) * bucketHours * HOUR),
        sessions: counts.get(index) ?? 0,
      })),
    };
  }

  async users(sort: string, direction: string, page: string) {
    if (!Object.hasOwn(userColumns, sort) || !['asc', 'desc'].includes(direction))
      throw new OnlineError('Orden no válido.');
    const result = await this.pool.query<AdminUser>(
      `select u.id, u.registered_at as "registeredAt", u.name, u.email,
         (select count(*)::int from (
            select a.id from hexfortia.account_match_archive a where a.user_id = u.id
            union
            select hexfortia.completed_offline_match_ids(account.data->>'hexagonal:progression:v1')
          ) offline)
         + (select count(*)::int from hexfortia.matches m
            where m.settled and m.player_ids @> array[u.id]) as matches,
         visits.recent as "recentVisits", visits.total as "totalVisits"
       from hexfortia.admin_users() u
       left join hexfortia.accounts account on account.user_id = u.id
       cross join lateral (
         select count(*)::int as total,
           count(*) filter (where started_at >= now() - interval '30 days')::int as recent
         from hexfortia.site_sessions where user_id = u.id
       ) visits
       order by ${userColumns[sort as AdminUserSort]} ${direction}, u.id
       limit $1 offset $2`,
      [PAGE_SIZE + 1, pageOffset(page)],
    );
    return { entries: result.rows.slice(0, PAGE_SIZE), hasMore: result.rows.length > PAGE_SIZE };
  }

  async history(page: string) {
    const { rows } = await this.pool.query<{
      id: string;
      mode: 'online' | 'local';
      completedAt: Date;
      entry: MatchHistoryEntry | null;
      record: MatchRecord | null;
    }>(
      `select * from (
         select 'online:' || id as id, 'online' as mode,
           coalesce(data #>> '{rankingResult,completedAt}', data #>> '{privateResult,completedAt}',
             data #>> '{record,updatedAt}')::timestamptz
             as "completedAt", null::jsonb as entry, data->'record' as record
         from hexfortia.matches where settled
         union all
         select 'account:' || user_id || ':' || id, 'local', completed_at, data, null::jsonb
         from hexfortia.account_match_archive
       ) history order by "completedAt" desc, id limit $1 offset $2`,
      [PAGE_SIZE + 1, pageOffset(page)],
    );
    const entries = rows.slice(0, PAGE_SIZE).flatMap((row): AdminMatch[] => {
      if (row.record) {
        const record = row.record;
        const outcome = replayRecord(record).outcome;
        if (!outcome) return [];
        return [
          {
            id: row.id,
            completedAt: row.completedAt.toISOString(),
            participants: [record.config.participants[0].name, record.config.participants[1].name],
            outcome,
            plies: record.currentAction,
            durationSeconds: matchDurationSeconds(record),
            mode: 'online',
            replayAvailable: true,
          },
        ];
      }
      const entry = row.entry;
      if (
        !entry ||
        entry.participants.length !== 2 ||
        !entry.participants.every((name) => typeof name === 'string') ||
        (entry.outcome.type === 'win' && ![0, 1].includes(entry.outcome.winner)) ||
        !Number.isSafeInteger(entry.plies) ||
        !Number.isFinite(entry.durationSeconds)
      )
        return [];
      return [
        {
          id: row.id,
          completedAt: row.completedAt.toISOString(),
          participants: entry.participants,
          outcome: entry.outcome,
          plies: entry.plies,
          durationSeconds: entry.durationSeconds,
          mode:
            Array.isArray(entry.record?.config?.participants) &&
            entry.record.config.participants.some(
              (player: unknown) =>
                player &&
                typeof player === 'object' &&
                'kind' in player &&
                player.kind === 'machine',
            )
              ? 'machine'
              : 'local',
          replayAvailable: typeof entry.record === 'object' && entry.record !== null,
        },
      ];
    });
    return { entries, hasMore: rows.length > PAGE_SIZE };
  }

  async replay(id: string) {
    const [source, owner, ...keys] = id.split(':');
    let raw: unknown;
    if (source === 'online' && isUuid(owner) && !keys.length) {
      const { rows } = await this.pool.query<{ record: unknown }>(
        "select data->'record' as record from hexfortia.matches where id = $1 and settled",
        [owner],
      );
      raw = rows[0]?.record;
    } else if (source === 'account' && isUuid(owner)) {
      const { rows } = await this.pool.query<{ record: unknown }>(
        "select data->'record' as record from hexfortia.account_match_archive where user_id = $1 and id = $2",
        [owner, keys.join(':')],
      );
      raw = rows[0]?.record;
    }
    if (!raw) throw new OnlineError('Repetición no disponible.', 404);
    try {
      const record = parseRecord(JSON.stringify(raw));
      if (replayRecord(record).outcome) return { record };
    } catch {
      // Old or damaged records remain visible in the history as summaries.
    }
    throw new OnlineError('No se pudo reconstruir esta repetición.', 422);
  }
}
