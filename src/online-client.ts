import { browserSupabase } from './supabase-client.js';
import type { OnlineClient, OnlineState } from './online-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Online transport shares Auth with accounts; local play does not require a connection. */
export function createOnlineClient(): OnlineClient | null {
  if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
    return null;
  let auth: Promise<SupabaseClient> | undefined;
  return {
    async request(request, signal) {
      auth ??= browserSupabase()!;
      const client = await auth;
      if (signal.aborted) throw new DOMException('Solicitud cancelada.', 'AbortError');
      const { data, error } = await client.auth.getSession();
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
      const response = await fetch('/api/online', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        cache: 'no-store',
      });
      const result: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          result &&
            typeof result === 'object' &&
            'error' in result &&
            typeof result.error === 'string'
            ? result.error
            : 'El servidor no está disponible. Inténtalo de nuevo.',
        );
      if (
        !result ||
        typeof result !== 'object' ||
        !('status' in result) ||
        !['idle', 'searching', 'private-waiting', 'playing'].includes(String(result.status))
      )
        throw new Error('La respuesta del servidor no es válida.');
      return result as OnlineState;
    },
    dispose() {
      auth = undefined;
    },
  };
}
