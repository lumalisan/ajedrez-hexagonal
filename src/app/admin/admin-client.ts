import { adminSupabase } from '../../supabase-client';

export class AdminRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function adminRequest<T>(
  query: Record<string, string>,
  signal?: AbortSignal,
  method = 'GET',
): Promise<T> {
  const sdk = await adminSupabase();
  if (!sdk) throw new Error('El acceso de administración necesita configurar Supabase.');
  const { data } = await sdk.auth.getSession();
  if (!data.session) throw new AdminRequestError('Vuelve a iniciar sesión.', 401);
  const timeout = AbortSignal.timeout(20_000);
  const response = await fetch('/api/admin?' + new URLSearchParams(query), {
    headers: { Authorization: 'Bearer ' + data.session.access_token },
    cache: 'no-store',
    method,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new AdminRequestError(
      error?.error ?? 'No se pudo conectar con la administración. Inténtalo de nuevo.',
      response.status,
    );
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}
