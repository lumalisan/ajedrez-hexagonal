import type {
  OnlineMatch,
  OnlinePlayer,
  OnlineRepository,
  OnlineTransaction,
  PrivateRoom,
  QueueEntry,
} from '../../server/repository';

/** Transactional double: serialization and rollback let application tests exercise races. */
export class MemoryOnlineRepository implements OnlineRepository {
  accounts = new Map<string, Omit<import('../../src/cloud-contracts').CloudSave, 'elo'>>();
  players = new Map<string, OnlinePlayer>();
  tickets = new Map<string, QueueEntry>();
  privateRooms = new Map<string, PrivateRoom>();
  matches = new Map<string, OnlineMatch>();
  private pending: Promise<unknown> = Promise.resolve();

  transaction<T>(_lock: string, work: (tx: OnlineTransaction) => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      const before = structuredClone([
        this.players,
        this.tickets,
        this.privateRooms,
        this.matches,
        this.accounts,
      ] as const);
      const tx: OnlineTransaction = {
        account: async (id) => structuredClone(this.accounts.get(id) ?? null),
        saveAccount: async (id, save) => {
          this.accounts.set(id, structuredClone(save));
        },
        player: async (id) => structuredClone(this.players.get(id) ?? null),
        savePlayer: async (player) => {
          this.players.set(player.id, structuredClone(player));
        },
        queue: async () =>
          structuredClone([...this.tickets.values()].sort((a, b) => a.joinedAt - b.joinedAt)),
        saveTicket: async (ticket) => {
          this.tickets.set(ticket.playerId, structuredClone(ticket));
        },
        removeTicket: async (id) => {
          this.tickets.delete(id);
        },
        rooms: async () => structuredClone([...this.privateRooms.values()]),
        saveRoom: async (room) => {
          if (this.privateRooms.has(room.code)) return false;
          this.privateRooms.set(room.code, structuredClone(room));
          return true;
        },
        removeRoom: async (code) => {
          this.privateRooms.delete(code);
        },
        activeMatch: async (id) =>
          structuredClone(
            [...this.matches.values()].find(
              (match) => match.players.includes(id) && !match.finishedBy.includes(id),
            ) ?? null,
          ),
        match: async (id) => structuredClone(this.matches.get(id) ?? null),
        saveMatch: async (match) => {
          this.matches.set(match.id, structuredClone(match));
        },
      };
      try {
        return await work(tx);
      } catch (error) {
        [this.players, this.tickets, this.privateRooms, this.matches, this.accounts] = before;
        throw error;
      }
    });
    this.pending = result.catch(() => undefined);
    return result;
  }

  async activeMatches(): Promise<string[]> {
    return [...this.matches.values()].filter((match) => !match.settled).map(({ id }) => id);
  }
}
