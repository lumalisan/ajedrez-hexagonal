import { describe, expect, it } from 'vitest';
import { AccountService } from '../server/account-service';
import { createOnlineApp } from '../server/app';
import { OnlineService } from '../server/online-service';
import { createPlayerProgression } from '../src/progression';
import { MemoryOnlineRepository } from './helpers/online-repository';

const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
describe('cuentas y guardados privados', () => {
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
