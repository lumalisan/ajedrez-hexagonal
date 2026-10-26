import { describe, expect, it, vi } from 'vitest';
import { createOnlineApp } from '../server/app';
import { OnlineService } from '../server/online-service';
import { MemoryOnlineRepository } from './helpers/online-repository';

describe('eliminación de cuentas', () => {
  it('solo elimina la identidad autenticada y rechaza invitados y otros orígenes', async () => {
    const remove = vi.fn(async () => {});
    const app = await createOnlineApp({
      service: new OnlineService(new MemoryOnlineRepository()),
      origin: 'https://example.com',
      deleteAccount: remove,
      authenticate: async (token) => ({ id: 'owner', isAnonymous: token === 'guest' }),
    });
    try {
      expect((await app.inject({ method: 'DELETE', url: '/api/account' })).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/api/account',
            headers: { authorization: 'Bearer guest' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/api/account',
            headers: { authorization: 'Bearer user', origin: 'https://other.test' },
          })
        ).statusCode,
      ).toBe(403);
      expect(remove).not.toHaveBeenCalled();
      const result = await app.inject({
        method: 'DELETE',
        url: '/api/account',
        headers: { authorization: 'Bearer user' },
        payload: { id: 'someone-else' },
      });
      expect(result.statusCode).toBe(204);
      expect(remove).toHaveBeenCalledExactlyOnceWith('owner');
    } finally {
      await app.close();
    }
  });
});
