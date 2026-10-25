import { describe, expect, it } from 'vitest';
import { RankingService } from '../server/ranking-service';
import { OnlineService } from '../server/online-service';
import { AccountService } from '../server/account-service';
import { createOnlineApp } from '../server/app';
import { createPlayerProgression } from '../src/progression';
import { MemoryOnlineRepository } from './helpers/online-repository';

const now = Date.parse('2026-10-25T12:00:00Z');
const a = '00000000-0000-0000-0000-000000000001';
const b = '00000000-0000-0000-0000-000000000002';

describe('clasificación compartida', () => {
  it('comparte perfiles sincronizados, filtra fechas y pagina sin exponer los guardados', async () => {
    const repository = new MemoryOnlineRepository();
    const accounts = new AccountService(repository);
    for (let i = 0; i < 53; i++) {
      const progress = createPlayerProgression();
      progress.ratings.machine = 1200;
      progress.matches['2026-10-25T10:00:00Z'] = {
        mode: 'machine',
        metrics: {},
        difficulty: 1,
        result: 1,
        completedAt: '2026-10-25T10:00:00Z',
      };
      progress.matches['2026-08-01T10:00:00Z'] = {
        mode: 'machine',
        metrics: {},
        difficulty: 1,
        result: 0,
        completedAt: '2026-08-01T10:00:00Z',
      };
      await accounts.request(String(i).padStart(3, '0'), {
        kind: 'save',
        revision: 0,
        data: {
          'hexagonal:user-profile:v1': JSON.stringify({ name: `Jugador ${i}` }),
          'hexagonal:progression:v1': JSON.stringify(progress),
          'atlas-match-history-v1': JSON.stringify('private-save'),
        },
      });
    }
    const service = new RankingService(repository, () => now);
    const first = await service.list({ mode: 'machine', period: 'all', page: 0 });
    const last = await service.list({ mode: 'machine', period: 'all', page: 1 });
    expect(first).toMatchObject({ total: 53, pageSize: 50 });
    expect(first.entries).toHaveLength(50);
    expect(last.entries).toHaveLength(3);
    expect(last.entries[0]).toMatchObject({
      position: 51,
      name: 'Jugador 50',
      played: 2,
      wins: 1,
      losses: 1,
      rating: 1200,
    });
    expect(Object.keys(first.entries[0]!).sort()).toEqual(
      ['position', 'name', 'played', 'wins', 'draws', 'losses', 'rating'].sort(),
    );
    const month = await service.list({ mode: 'machine', period: 'month', page: 0 });
    expect(month.entries[0]).toMatchObject({ played: 1, wins: 1, losses: 0, rating: 1020 });
    expect((await service.list({ mode: 'online', period: 'all', page: 0 })).total).toBe(0);
  });

  it('usa resultados y Elo del servidor para ambos jugadores, también con registros anteriores', async () => {
    const repository = new MemoryOnlineRepository();
    let clock = now;
    const online = new OnlineService(repository, () => clock);
    await online.request(a, { kind: 'search', name: 'Cian' });
    const state = await online.request(b, { kind: 'search', name: 'Ámbar' });
    if (state.status !== 'playing') throw new Error('Debe haber partida');
    await online.request(a, { kind: 'resign', matchId: state.matchId });
    const service = new RankingService(repository, () => clock);
    const publicMatch = repository.matches.get(state.matchId)!;
    repository.matches.set('private-copy', { ...publicMatch, id: 'private-copy', ranked: false });
    const query = { mode: 'online', period: 'all', page: 0 } as const;
    const result = await service.list(query);
    expect(result.entries).toMatchObject([
      { name: 'Ámbar', position: 1, played: 1, wins: 1, rating: 1020 },
      { name: 'Cian', position: 2, played: 1, losses: 1, rating: 980 },
    ]);
    // Duplicate polls and a forged cloud rating cannot add victories or alter Elo.
    await online.request(b, { kind: 'state' });
    const forged = createPlayerProgression();
    forged.ratings.online = 99999;
    forged.matches.fake = {
      mode: 'online',
      metrics: {},
      difficulty: 0,
      completedAt: new Date(clock).toISOString(),
      result: 1,
    };
    await new AccountService(repository).request(a, {
      kind: 'save',
      revision: 0,
      data: { 'hexagonal:progression:v1': JSON.stringify(forged) },
    });
    expect((await service.list(query)).entries.map(({ rating }) => rating)).toEqual([1020, 980]);
    const match = repository.matches.get(state.matchId)!;
    delete match.rankingResult;
    expect((await service.list(query)).entries.map(({ wins, losses }) => [wins, losses])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    clock = Date.parse('2027-01-01T12:00:00Z');
    expect((await service.list({ ...query, period: 'month' })).entries).toEqual([]);
    match.ranked = false;
    repository.players.clear();
    expect((await service.list(query)).entries).toEqual([]);
  });

  it('permite la consulta pública desde distintos clientes y rechaza filtros inválidos', async () => {
    const repository = new MemoryOnlineRepository();
    const progress = createPlayerProgression();
    progress.matches['2026-10-25T10:00:00Z'] = {
      mode: 'machine',
      metrics: {},
      difficulty: 1,
      result: 1,
      completedAt: '2026-10-25T10:00:00Z',
    };
    await new AccountService(repository).request(a, {
      kind: 'save',
      revision: 0,
      data: {
        'hexagonal:user-profile:v1': JSON.stringify({ name: 'Perfil compartido' }),
        'hexagonal:progression:v1': JSON.stringify(progress),
      },
    });
    const app = await createOnlineApp({
      service: new OnlineService(repository),
      rankings: new RankingService(repository, () => now),
      origin: 'https://example.com',
      authenticate: async () => null,
    });
    try {
      const first = await app.inject({
        method: 'GET',
        url: '/api/ranking?mode=machine&period=month&page=0',
      });
      const second = await app.inject({
        method: 'GET',
        url: '/api/ranking?mode=machine&period=month&page=0',
      });
      expect(first.statusCode).toBe(200);
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.json()).toEqual(second.json());
      expect(first.json().entries).toMatchObject([
        { name: 'Perfil compartido', played: 1, wins: 1 },
      ]);
      for (const query of [
        'mode=local',
        'period=year',
        'page=-1',
        'page=1.5',
        'page=9007199254740992',
      ])
        expect((await app.inject({ method: 'GET', url: `/api/ranking?${query}` })).statusCode).toBe(
          400,
        );
    } finally {
      await app.close();
    }
  });
});
