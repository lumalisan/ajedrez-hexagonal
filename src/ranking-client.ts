import type { RankingClient, RankingPage } from './ranking-contracts';
import { browserSupabase } from './supabase-client';

export const fetchRanking: RankingClient = async (query, signal) => {
  const failure =
    'No se pudo cargar la clasificación compartida. Comprueba la conexión y reinténtalo.';
  const params = new URLSearchParams({ ...query, page: String(query.page) });
  const sdk = browserSupabase();
  const session = sdk ? (await (await sdk).auth.getSession()).data.session : null;
  if (!session || session.user.is_anonymous)
    throw new Error('Inicia sesión con una cuenta para consultar la clasificación completa.');
  const response = await fetch(`/api/ranking?${params}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    cache: 'no-store',
  }).catch(() => {
    throw new Error(failure);
  });
  const value: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !value ||
    typeof value !== 'object' ||
    !('entries' in value) ||
    !Array.isArray(value.entries) ||
    !('total' in value) ||
    typeof value.total !== 'number' ||
    !Number.isSafeInteger(value.total) ||
    value.total < 0 ||
    value.entries.length > 50 ||
    !('pageSize' in value) ||
    value.pageSize !== 50 ||
    !('mode' in value) ||
    value.mode !== query.mode ||
    !('period' in value) ||
    value.period !== query.period ||
    !('page' in value) ||
    value.page !== query.page ||
    !value.entries.every(
      (entry: unknown) =>
        entry &&
        typeof entry === 'object' &&
        'name' in entry &&
        typeof entry.name === 'string' &&
        ['position', 'played', 'wins', 'draws', 'losses', 'rating'].every(
          (key) =>
            key in entry &&
            Number.isSafeInteger(Reflect.get(entry, key)) &&
            Reflect.get(entry, key) >= 0,
        ),
    )
  )
    throw new Error(failure);
  return value as RankingPage;
};

export async function fetchPublicProfile(
  id: string,
  signal: AbortSignal,
): Promise<import('./ranking-contracts').PublicPlayerProfile> {
  const sdk = browserSupabase();
  const session = sdk ? (await (await sdk).auth.getSession()).data.session : null;
  if (!session || session.user.is_anonymous)
    throw new Error('Inicia sesión para consultar perfiles.');
  const response = await fetch('/api/ranking?playerId=' + encodeURIComponent(id), {
    headers: { Authorization: 'Bearer ' + session.access_token },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('No se pudo cargar el perfil. Vuelve a intentarlo.');
  return response.json();
}
