import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOnlineClient, OnlineRequestError } from '../src/online-client';
import { createClassicConfig } from '../src/game-config';
import { createMatchRecord } from '../src/match-record';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), signInAnonymously: vi.fn() }));
vi.mock('../src/supabase-client', () => ({ browserSupabase: () => Promise.resolve({ auth }) }));
const session = { user: { is_anonymous: false }, access_token: 'test-token' };

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://auth.example.test');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-test');
  auth.getSession.mockReset().mockResolvedValue({ data: { session }, error: null });
  auth.signInAnonymously.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function client() {
  const client = createOnlineClient();
  if (!client) throw new Error('Missing test configuration');
  return client;
}

describe('transporte de partidas en línea', () => {
  it('valida la partida recibida y usa autorización, cancelación y ausencia de caché', async () => {
    const record = createMatchRecord(createClassicConfig({ mode: 'local' }));
    const position = {
      status: 'playing',
      matchId: 'match',
      player: 0,
      revision: 0,
      record,
      elo: 1000,
      serverNow: Date.now(),
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(position));
    vi.stubGlobal('fetch', fetch);
    const abort = new AbortController();
    expect(await client().request({ kind: 'state' }, abort.signal)).toEqual(position);
    expect(fetch).toHaveBeenCalledWith(
      '/api/online',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      }),
    );
    abort.abort();
    expect((fetch.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
  });

  it.each([
    null,
    { status: 'playing' },
    { status: 'private-waiting', code: 123456, expiresAt: 1 },
    { status: 'private-waiting', code: 'abc', expiresAt: 1 },
    { status: 'searching', joinedAt: 'now', elo: 1000 },
    {
      status: 'playing',
      matchId: 'match',
      player: 0,
      revision: 0,
      elo: 1000,
      serverNow: 1,
      record: { version: 2 },
    },
  ])('rechaza una respuesta incompleta o dañada (%#)', async (value) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(value)));
    await expect(client().request({ kind: 'state' }, new AbortController().signal)).rejects.toThrow(
      'respuesta del servidor no es válida',
    );
  });

  it.each([401, 403, 409, 429, 503])('conserva el estado HTTP %s y Retry-After', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: 'Error público' }, { status, headers: { 'Retry-After': '10' } }),
        ),
    );
    await expect(
      client().request({ kind: 'state' }, new AbortController().signal),
    ).rejects.toMatchObject({
      message: 'Error público',
      statusCode: status,
      retryAfterMs: 10_000,
    } satisfies Partial<OnlineRequestError>);
  });

  it('explica los fallos de red en español', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(client().request({ kind: 'state' }, new AbortController().signal)).rejects.toThrow(
      'Comprueba tu conexión',
    );
  });

  it('cancela durante Auth sin enviar una petición al terminar una sesión antigua', async () => {
    let complete!: (value: unknown) => void;
    auth.getSession.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const abort = new AbortController();
    const operation = client().request({ kind: 'state' }, abort.signal);
    await Promise.resolve();
    abort.abort();
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    complete({ data: { session } });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('limita el tiempo de espera incluso cuando Auth no responde', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    auth.getSession.mockReturnValue(new Promise(() => {}));
    const operation = client().request({ kind: 'state' }, new AbortController().signal);
    deadline.abort(new DOMException('Timeout', 'TimeoutError'));
    await expect(operation).rejects.toThrow('conexión tarda demasiado');
  });

  it('impide buscar como invitado sin crear una sesión anónima', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      client().request({ kind: 'search', name: 'Jugador' }, new AbortController().signal),
    ).rejects.toThrow('Inicia sesión con una cuenta');
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
