import { browserSupabase } from './supabase-client.js';
import type { CloudRequest, CloudSave } from './cloud-contracts.js';

export interface AccountUser {
  id: string;
  email: string;
}
export class CloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export interface AccountClient {
  watch(listener: (user: AccountUser | null, recovery?: boolean) => void): Promise<() => void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<boolean>;
  signOut(): Promise<void>;
  recover(email: string): Promise<void>;
  password(password: string): Promise<void>;
  cloud(userId: string, request: CloudRequest, signal: AbortSignal): Promise<CloudSave>;
}

export function createAccountClient(): AccountClient | null {
  const sdk = browserSupabase();
  if (!sdk) return null;
  return {
    async watch(listener) {
      const { auth } = await sdk;
      const deliver = (user: import('@supabase/supabase-js').User | undefined, recovery = false) =>
        listener(
          user && !user.is_anonymous ? { id: user.id, email: user.email ?? '' } : null,
          recovery,
        );
      const { data } = auth.onAuthStateChange((event, session) => {
        queueMicrotask(() => deliver(session?.user, event === 'PASSWORD_RECOVERY'));
      });
      const initial = await auth.getSession();
      if (initial.error) {
        data.subscription.unsubscribe();
        throw new Error('No se pudo recuperar la sesión.');
      }
      deliver(initial.data.session?.user);
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await (await sdk).auth.signInWithPassword({ email, password });
      if (error)
        throw new Error(
          'No se pudo iniciar sesión. Revisa el correo, la contraseña y la confirmación del correo.',
        );
    },
    async signUp(email, password) {
      const { data, error } = await (
        await sdk
      ).auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
      if (error)
        throw new Error('No se pudo crear la cuenta. Revisa los datos o inténtalo más tarde.');
      return !data.session;
    },
    async signOut() {
      const { error } = await (await sdk).auth.signOut({ scope: 'local' });
      if (error) throw new Error('No se pudo cerrar sesión. Inténtalo de nuevo.');
    },
    async recover(email) {
      const { error } = await (
        await sdk
      ).auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
      if (error) throw new Error('No se pudo enviar el enlace. Inténtalo más tarde.');
    },
    async password(password) {
      const { error } = await (await sdk).auth.updateUser({ password });
      if (error)
        throw new Error(
          'No se pudo actualizar la contraseña. Solicita otro enlace e inténtalo de nuevo.',
        );
    },
    async cloud(userId, request, signal) {
      const { data, error } = await (await sdk).auth.getSession();
      const session = data.session;
      if (error || !session || session.user.id !== userId || session.user.is_anonymous)
        throw new CloudError('La sesión ha cambiado. Vuelve a iniciar sesión.', 401);
      const response = await fetch('/api/account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        cache: 'no-store',
      });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new CloudError(
          value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
            ? value.error
            : 'No se pudo conectar con el guardado en la nube.',
          response.status,
        );
      if (
        !value ||
        typeof value !== 'object' ||
        !('revision' in value) ||
        !Number.isSafeInteger(value.revision) ||
        !('data' in value) ||
        !value.data ||
        typeof value.data !== 'object' ||
        !('elo' in value) ||
        typeof value.elo !== 'number'
      )
        throw new CloudError('Respuesta de guardado no válida.', 503);
      return value as CloudSave;
    },
  };
}
