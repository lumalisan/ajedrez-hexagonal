import { browserSupabase } from './supabase-client.js';
import { parseRecord } from './match-record.js';
import type { OnlineClient, OnlineState } from './online-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

export class OnlineRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryAfterMs = 0,
  ) {
    super(message);
  }
}

/** Online transport shares Auth with accounts; local play does not require a connection. */
export function createOnlineClient(): OnlineClient | null {
  if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
    return null;
  let auth: Promise<SupabaseClient> | undefined;
  return {
    async request(request, signal) {
      const timeout = AbortSignal.timeout(15_000);
      const requestSignal = AbortSignal.any([signal, timeout]);
      try {
        return await abortable(perform(), requestSignal);
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (timeout.aborted)
          throw new Error('La conexión tarda demasiado. Comprueba tu conexión y reintenta.', {
            cause: error,
          });
        if (error instanceof TypeError)
          throw new Error('No se ha podido conectar. Comprueba tu conexión y reintenta.', {
            cause: error,
          });
        throw error;
      }

      async function perform(): Promise<OnlineState> {
        auth ??= browserSupabase()!;
        const client = await auth;
        requestSignal.throwIfAborted();
        const { data, error } = await client.auth.getSession();
        requestSignal.throwIfAborted();
        if (error) throw new Error('No se ha podido recuperar la sesión en línea.');
        let session = data.session;
        if (request.kind === 'search' && (!session || session.user.is_anonymous))
          throw new Error('Inicia sesión con una cuenta para buscar partida.');
        if (!session) {
          const result = await client.auth.signInAnonymously();
          if (result.error || !result.data.session)
            throw new Error(
              'No se ha podido iniciar sesión en línea. Comprueba la conexión e inténtalo de nuevo.',
            );
          session = result.data.session;
        }
        requestSignal.throwIfAborted();
        const response = await fetch('/api/online', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(request),
          signal: requestSignal,
          cache: 'no-store',
        });
        const result: unknown = await response.json().catch(() => null);
        if (!response.ok)
          throw new OnlineRequestError(
            result &&
              typeof result === 'object' &&
              'error' in result &&
              typeof result.error === 'string'
              ? result.error
              : 'El servidor no está disponible. Inténtalo de nuevo.',
            response.status,
            Math.min(30_000, Math.max(0, Number(response.headers.get('Retry-After')) || 0) * 1_000),
          );
        try {
          return validateState(result);
        } catch {
          throw new Error('La respuesta del servidor no es válida.');
        }
      }
    },
    dispose() {
      auth = undefined;
    },
  };
}

function validateState(value: unknown): OnlineState {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('status' in value))
    throw new Error();
  const candidate = value as OnlineState;
  switch (candidate.status) {
    case 'idle':
      return { status: 'idle' };
    case 'searching':
      if (!Number.isFinite(candidate.joinedAt) || !Number.isFinite(candidate.elo)) break;
      return candidate;
    case 'private-waiting':
      if (
        typeof candidate.code !== 'string' ||
        !/^\d{6}$/.test(candidate.code) ||
        !Number.isFinite(candidate.expiresAt)
      )
        break;
      return candidate;
    case 'playing': {
      if (
        typeof candidate.matchId !== 'string' ||
        !candidate.matchId ||
        ![0, 1].includes(candidate.player) ||
        !Number.isSafeInteger(candidate.revision) ||
        candidate.revision < 0 ||
        !Number.isFinite(candidate.elo) ||
        !Number.isFinite(candidate.serverNow) ||
        (candidate.drawOffer != null && ![0, 1].includes(candidate.drawOffer))
      )
        break;
      const record = parseRecord(JSON.stringify(candidate.record));
      if (record.currentAction !== record.actions.length) break;
      return { ...candidate, record };
    }
  }
  throw new Error();
}

/** Auth SDK work cannot be aborted, but must not keep a disposed session's queue blocked. */
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
