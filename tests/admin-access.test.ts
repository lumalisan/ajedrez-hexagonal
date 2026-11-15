import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { AdminService } from '../server/admin-service';
import { createOnlineApp } from '../server/app';
import { OnlineService } from '../server/online-service';
import { replayRecord } from '../src/match-record';
import { MemoryOnlineRepository } from './helpers/online-repository';

const adminId = '00000000-0000-4000-8000-000000000001';
const playerId = '00000000-0000-4000-8000-000000000002';
const sessionId = '00000000-0000-4000-8000-000000000003';
const visitorId = '00000000-0000-4000-8000-000000000004';
const origin = 'https://example.test';

describe('administración privada', () => {
  it('protege datos y eliminaciones con la identidad verificada y comprueba el origen', async () => {
    const admin = new AdminService({} as Pool);
    const users = vi.spyOn(admin, 'users').mockResolvedValue({ entries: [], hasMore: false });
    const visit = vi.spyOn(admin, 'visit').mockResolvedValue(undefined);
    const remove = vi.fn(async () => {});
    const app = await createOnlineApp({
      service: new OnlineService(new MemoryOnlineRepository()),
      origin,
      admin,
      adminUserId: adminId,
      deleteManagedAccount: remove,
      async authenticate(token) {
        if (token === 'bad') return null;
        return { id: token === 'player' ? playerId : adminId, isAnonymous: token === 'guest' };
      },
    });
    const headers = (token: string) => ({ origin, authorization: 'Bearer ' + token });
    const url = '/api/admin?view=users';
    try {
      expect((await app.inject(url)).statusCode).toBe(401);
      expect((await app.inject({ url, headers: headers('bad') })).statusCode).toBe(401);
      for (const token of ['player', 'guest']) {
        expect((await app.inject({ url, headers: headers(token) })).statusCode).toBe(403);
        expect(
          (
            await app.inject({
              method: 'DELETE',
              url: '/api/admin?id=' + playerId,
              headers: headers(token),
            })
          ).statusCode,
        ).toBe(403);
      }
      expect(users).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      const result = await app.inject({ url, headers: headers('admin') });
      expect(result.statusCode).toBe(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(users).toHaveBeenCalledWith('registeredAt', 'desc', '0');
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/api/admin?id=' + playerId,
            headers: headers('admin'),
          })
        ).statusCode,
      ).toBe(204);
      expect(remove).toHaveBeenCalledExactlyOnceWith(playerId);
      const capture = {
        method: 'POST' as const,
        url: '/api/visit',
        payload: { id: sessionId, visitorId, userId: adminId },
      };
      expect((await app.inject(capture)).statusCode).toBe(403);
      expect((await app.inject({ ...capture, headers: { origin } })).statusCode).toBe(204);
      expect((await app.inject({ ...capture, headers: headers('player') })).statusCode).toBe(204);
      expect(visit.mock.calls).toEqual([
        [sessionId, visitorId, null],
        [sessionId, visitorId, playerId],
      ]);
    } finally {
      await app.close();
    }
  });

  it('cierra como abandono una partida que aún está en el sorteo y liquida el resultado una vez', async () => {
    const repository = new MemoryOnlineRepository();
    const service = new OnlineService(repository);
    await service.request(adminId, { kind: 'search', name: 'Cian' });
    const rival = await service.request(playerId, { kind: 'search', name: 'Ámbar' });
    if (rival.status !== 'playing') throw new Error('No se creó la partida.');
    await repository.transaction('match:' + rival.matchId, async (tx) => {
      const match = (await tx.match(rival.matchId))!;
      expect(match.opening).toBeDefined();
      await service.closeMatchForAccountDeletion(tx, match, playerId);
      await service.closeMatchForAccountDeletion(tx, match, playerId);
    });
    const match = repository.matches.get(rival.matchId)!;
    expect(match.settled).toBe(true);
    expect(match.opening).toBeUndefined();
    expect(replayRecord(match.record).outcome).toEqual({
      type: 'win',
      reason: 'resignation',
      winner: match.players.indexOf(adminId),
    });
    expect(repository.players.get(adminId)?.played).toBe(1);
  });
});
