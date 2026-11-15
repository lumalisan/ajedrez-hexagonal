import { useEffect, useState } from 'react';
import { adminRequest } from './admin-client';

export type AuthFailure = (cause: unknown) => void;
export const adminNumber = new Intl.NumberFormat('es-ES');
export const adminDate = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Madrid',
});

export function useAdminData<T>(query: string, onAuthFailure: AuthFailure) {
  const [attempt, setAttempt] = useState(0);
  const key = query + '#' + attempt;
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    adminRequest<T>(Object.fromEntries(new URLSearchParams(query)), controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        onAuthFailure(cause);
        setResult({
          key,
          error: cause instanceof Error ? cause.message : 'No se pudieron cargar los datos.',
        });
      },
    );
    return () => controller.abort();
  }, [key, query, onAuthFailure]);
  return { ...(result?.key === key ? result : {}), reload: () => setAttempt((n) => n + 1) };
}
