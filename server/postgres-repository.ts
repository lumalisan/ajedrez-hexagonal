import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type {
  OnlineMatch,
  OnlinePlayer,
  OnlineRepository,
  OnlineTransaction,
  PrivateRoom,
  QueueEntry,
} from './repository.js';

/** Tables are in a private schema; only the Node server's database role can access them. */
export class PostgresOnlineRepository implements OnlineRepository {
  constructor(private readonly pool: Pool) {}

  async rankingData(mode: import('../src/ranking-contracts.js').RankingMode) {
    const [accounts, players, matches] = await Promise.all([
      this.pool.query<{ id: string; profile: string | null; progression: string | null }>(
        `select user_id as id, data->>'hexagonal:user-profile:v1' as profile,
         case when $1 = 'machine' then data->>'hexagonal:progression:v1' else null end as progression from hexfortia.accounts`,
        [mode],
      ),
      mode === 'online'
        ? this.pool.query<OnlinePlayer>(
            'select id, name, elo, played from hexfortia.players where played > 0',
          )
        : Promise.resolve({ rows: [] }),
      mode === 'online'
        ? this.pool.query<{ data: OnlineMatch }>(
            `select data from hexfortia.matches where settled = true and data->>'ranked' = 'true'`,
          )
        : Promise.resolve({ rows: [] }),
    ]);
    return {
      accounts: accounts.rows,
      players: players.rows,
      matches: matches.rows.map(({ data }) => data),
    };
  }

  async transaction<T>(lock: string, work: (tx: OnlineTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('statement_timeout', '10000', true)");
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lock]);
      const result = await work(transaction(client));
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async activeMatches(): Promise<string[]> {
    const result = await this.pool.query<{ id: string }>(
      'select id from hexfortia.matches where settled = false',
    );
    return result.rows.map(({ id }) => id);
  }
}

function transaction(client: PoolClient): OnlineTransaction {
  async function rows<T extends QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
    return (await client.query<T>(sql, values)).rows;
  }
  return {
    async account(id) {
      return (
        (
          await rows<{ revision: number; data: import('../src/cloud-contracts.js').PlayerData }>(
            'select revision, data from hexfortia.accounts where user_id = $1 for update',
            [id],
          )
        )[0] ?? null
      );
    },
    async saveAccount(id, save) {
      await client.query(
        'insert into hexfortia.accounts (user_id, revision, data) values ($1,$2,$3) on conflict (user_id) do update set revision = $2, data = $3, updated_at = now()',
        [id, save.revision, save.data],
      );
    },
    async player(id) {
      return (
        (
          await rows<OnlinePlayer>(
            'select id, name, elo, played from hexfortia.players where id = $1 for update',
            [id],
          )
        )[0] ?? null
      );
    },
    async savePlayer(p) {
      await client.query(
        'insert into hexfortia.players (id, name, elo, played) values ($1,$2,$3,$4) on conflict (id) do update set name = $2, elo = $3, played = $4',
        [p.id, p.name, p.elo, p.played],
      );
    },
    async queue() {
      return (
        await rows<{ data: QueueEntry }>(
          'select data from hexfortia.queue order by joined_at, player_id',
        )
      ).map(({ data }) => data);
    },
    async saveTicket(ticket) {
      await client.query(
        'insert into hexfortia.queue (player_id, joined_at, data) values ($1,$2,$3) on conflict (player_id) do update set data = $3',
        [ticket.playerId, new Date(ticket.joinedAt), ticket],
      );
    },
    async removeTicket(id) {
      await client.query('delete from hexfortia.queue where player_id = $1', [id]);
    },
    async rooms() {
      return (await rows<{ data: PrivateRoom }>('select data from hexfortia.rooms')).map(
        ({ data }) => data,
      );
    },
    async saveRoom(room) {
      const result = await client.query(
        'insert into hexfortia.rooms (code, creator_id, data) values ($1,$2,$3) on conflict do nothing',
        [room.code, room.creatorId, room],
      );
      return result.rowCount === 1;
    },
    async removeRoom(code) {
      await client.query('delete from hexfortia.rooms where code = $1', [code]);
    },
    async activeMatch(id) {
      return (
        (
          await rows<{ data: OnlineMatch }>(
            "select data from hexfortia.matches where $1 = any(player_ids) and not (data->'finishedBy' @> to_jsonb(array[$1]::text[])) order by created_at desc limit 1",
            [id],
          )
        )[0]?.data ?? null
      );
    },
    async match(id) {
      return (
        (
          await rows<{ data: OnlineMatch }>(
            'select data from hexfortia.matches where id = $1 for update',
            [id],
          )
        )[0]?.data ?? null
      );
    },
    async saveMatch(match) {
      await client.query(
        'insert into hexfortia.matches (id, player_ids, settled, data) values ($1,$2,$3,$4) on conflict (id) do update set settled = $3, data = $4',
        [match.id, match.players, match.settled, match],
      );
    },
  };
}
