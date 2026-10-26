import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRanking } from '../src/ranking-client';
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../src/supabase-client', () => ({ browserSupabase: () => Promise.resolve({ auth }) }));
beforeEach(() =>
  auth.getSession.mockResolvedValue({
    data: { session: { user: { is_anonymous: false }, access_token: 'test-token' } },
  }),
);

const query = { mode: 'online', period: 'month', page: 0 } as const;
const page = {
  ...query,
  total: 1,
  pageSize: 50,
  entries: [
    { name: 'Otro jugador', position: 1, played: 1, wins: 1, draws: 0, losses: 0, rating: 1020 },
  ],
};
afterEach(() => vi.unstubAllGlobals());
describe('transporte de clasificación', () => {
  it.each([null, { user: { is_anonymous: true } }])(
    'impide consultar sin cuenta (%#)',
    async (session) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      auth.getSession.mockResolvedValue({ data: { session } });
      await expect(fetchRanking(query, new AbortController().signal)).rejects.toThrow(
        'Inicia sesión con una cuenta',
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('consulta el servidor sin caché y conserva los filtros y la cancelación', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(page));
    vi.stubGlobal('fetch', fetch);
    const abort = new AbortController();
    expect(await fetchRanking(query, abort.signal)).toEqual(page);
    expect(fetch).toHaveBeenCalledWith(
      '/api/ranking?mode=online&period=month&page=0',
      expect.objectContaining({
        cache: 'no-store',
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
    const signal = fetch.mock.calls[0]![1].signal as AbortSignal;
    abort.abort();
    expect(signal.aborted).toBe(true);
  });
  it.each([
    () => Promise.reject(new TypeError('Failed to fetch')),
    () => Promise.resolve(Response.json({ error: 'Unavailable' }, { status: 503 })),
    () => Promise.resolve(new Response('<html>offline</html>')),
    () => Promise.resolve(Response.json({ ...page, mode: 'machine' })),
    () =>
      Promise.resolve(Response.json({ ...page, entries: [{ ...page.entries[0], rating: -1 }] })),
  ])(
    'muestra un error recuperable en español ante fallos o datos inválidos (%#)',
    async (response) => {
      vi.stubGlobal('fetch', vi.fn(response));
      await expect(fetchRanking(query, new AbortController().signal)).rejects.toThrow(
        'Comprueba la conexión y reinténtalo',
      );
    },
  );
});
