import { describe, expect, it } from 'vitest';
import { AccountService } from '../server/account-service';
import { createOnlineApp } from '../server/app';
import { OnlineService } from '../server/online-service';
import { RankingService } from '../server/ranking-service';
import { replayRecord } from '../src/match-record';
import { createPlayerProgression, parsePlayerProgression } from '../src/progression';
import { MemoryOnlineRepository } from './helpers/online-repository';

const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
describe('cuentas y guardados privados', () => {
  it.each([true, false])(
    'recupera una partida privada para ambos perfiles y deja intacta la clasificación (resultado guardado: %s)',
    async (hasPrivateResult) => {
      const repository = new MemoryOnlineRepository();
      const accounts = new AccountService(repository);
      let now = Date.now();
      const online = new OnlineService(repository, () => now);
      const ranking = new RankingService(repository, () => now);
      for (const id of [a, b]) await accounts.request(id, { kind: 'save', revision: 0, data: {} });
      const room = await online.request(a, {
        kind: 'create-private',
        name: 'Cian',
        settings: {
          faction: 'expansionist',
          fortressHp: 1,
          turnSeconds: '',
          totalSeconds: '',
          layout: 3,
        },
      });
      if (room.status !== 'private-waiting') throw new Error('No se creó la sala.');
      const joined = await online.request(b, {
        kind: 'join-private',
        code: room.code,
        name: 'Ámbar',
      });
      if (joined.status !== 'playing' || !joined.opening) throw new Error('No se creó la partida.');
      const { matchId, record } = joined;
      expect((await ranking.ownProfile(a)).statistics.online.played).toBe(0);
      now = joined.opening.revealsAt;
      for (const id of [a, b]) await online.request(id, { kind: 'ready', matchId });
      const loser = repository.matches.get(matchId)!.players[replayRecord(record).activePlayer];
      await online.request(loser, { kind: 'resign', matchId });
      for (const id of [a, b]) await online.request(id, { kind: 'finish', matchId });
      if (!hasPrivateResult) delete repository.matches.get(matchId)!.privateResult;

      for (const id of [a, b]) {
        const key = 'hexagonal:progression:v1';
        const loaded = await accounts.request(id, { kind: 'load' });
        const progress = parsePlayerProgression(loaded.data[key]!);
        expect(progress.matches[record.createdAt]).toMatchObject({
          mode: 'online',
          rated: false,
          result: Number(id !== loser),
        });
        expect(progress.xp).toBeGreaterThan(0);
        expect(Object.keys(progress.unlockedAt).length).toBeGreaterThan(0);
        const saved = await accounts.request(id, {
          kind: 'save',
          revision: loaded.revision,
          data: loaded.data,
        });
        const retried = await accounts.request(id, { kind: 'merge-progress', data: loaded.data });
        expect(retried).toEqual(saved);
        expect(repository.players.get(id)).toMatchObject({ elo: 1000, played: 0 });
        const profile = await ranking.ownProfile(id);
        expect(profile.statistics.online).toMatchObject({
          played: 1,
          wins: Number(id !== loser),
          losses: Number(id === loser),
        });
        expect(profile.progression.xp).toBe(progress.xp);
      }
      expect((await ranking.list({ mode: 'online', period: 'all', page: 0 })).entries).toEqual([]);
    },
  );
  it('aísla cuentas, conserva progreso y solo acepta una escritura de la misma revisión', async () => {
    const repository = new MemoryOnlineRepository();
    const service = new AccountService(repository);
    const data = {
      'hexagonal:user-profile:v1': JSON.stringify({ name: 'A', color: 'cyan', emblem: 'fortress' }),
    };
    const saves = await Promise.allSettled(
      [1, 2].map(() => service.request(a, { kind: 'save', revision: 0, data })),
    );
    expect(saves.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(saves.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await service.request(a, { kind: 'load' })).toEqual({ revision: 1, data, elo: 1000 });
    expect(await service.request(b, { kind: 'load' })).toEqual({
      revision: 0,
      data: {},
      elo: 1000,
    });
    await expect(service.request(a, { kind: 'save', revision: 0, data: {} })).rejects.toThrow(
      'otro dispositivo',
    );
  });
  it('el Elo público siempre procede del servidor, incluso en un progreso importado o modificado', async () => {
    const repository = new MemoryOnlineRepository();
    repository.players.set(a, { id: a, name: 'A', elo: 1130, played: 4 });
    const service = new AccountService(repository);
    const progress = createPlayerProgression();
    progress.xp = 500;
    progress.ratings.online = 9000;
    const saved = await service.request(a, {
      kind: 'save',
      revision: 0,
      data: { 'hexagonal:progression:v1': JSON.stringify(progress) },
    });
    expect(JSON.parse(saved.data['hexagonal:progression:v1']!).ratings.online).toBe(1130);
    expect(JSON.parse(saved.data['hexagonal:progression:v1']!).xp).toBe(500);
    expect(repository.players.get(a)?.elo).toBe(1130);
    repository.players.get(a)!.elo = 1150;
    expect(
      JSON.parse((await service.request(a, { kind: 'load' })).data['hexagonal:progression:v1']!)
        .ratings.online,
    ).toBe(1150);
    await expect(
      service.request(a, { kind: 'save', revision: 1, data: { token: '"secret"' } as never }),
    ).rejects.toThrow('no permitidos');
    await expect(
      service.request(a, {
        kind: 'save',
        revision: 1,
        data: { 'hexagonal:user-profile:v1': 'broken' },
      }),
    ).rejects.toThrow('dañados');
  });
  it('bloquea a invitados en la búsqueda y la nube sin bloquear las privadas', async () => {
    const repository = new MemoryOnlineRepository();
    const app = await createOnlineApp({
      service: new OnlineService(repository),
      accounts: new AccountService(repository),
      origin: 'https://game.example',
      authenticate: async (token) =>
        token === 'guest'
          ? { id: a, isAnonymous: true }
          : token === 'account'
            ? { id: b, isAnonymous: false }
            : null,
    });
    try {
      const call = (url: string, payload: unknown, token = 'guest') =>
        app.inject({
          method: 'POST',
          url,
          payload: JSON.stringify(payload),
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        });
      expect((await call('/api/online', { kind: 'search', name: 'Invitado' })).statusCode).toBe(
        403,
      );
      expect(repository.tickets.size).toBe(0);
      expect((await call('/api/account', { kind: 'load' })).statusCode).toBe(403);
      expect((await call('/api/account', { kind: 'load' }, 'invalid')).statusCode).toBe(401);
      expect(
        (await call('/api/account', { kind: 'save', revision: 0, data: {} }, 'account')).statusCode,
      ).toBe(200);
      expect(repository.accounts.has(a)).toBe(false);
      expect(repository.accounts.has(b)).toBe(true);
      expect(
        (
          await call('/api/online', {
            kind: 'create-private',
            name: 'Invitado',
            settings: {
              faction: 'expansionist',
              fortressHp: 1,
              turnSeconds: '',
              totalSeconds: '',
              layout: 3,
            },
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });
});
