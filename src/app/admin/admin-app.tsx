import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ADMIN_AUTH_STORAGE_KEY, adminSupabase } from '../../supabase-client';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { AdminRequestError, adminRequest } from './admin-client';
import { AdminHistory, AdminUsers } from './admin-lists';
import { AdminStatistics } from './admin-statistics';
import './admin.css';

const sections = [
  { id: 'statistics', label: 'Estadísticas' },
  { id: 'users', label: 'Usuarios' },
  { id: 'history', label: 'Historial de partidas' },
] as const;

export function AdminApp() {
  const [access, setAccess] = useState<'checking' | 'signed-out' | 'allowed'>('checking');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState<(typeof sections)[number]['id']>('statistics');
  const [accountId, setAccountId] = useState('');

  const closeSession = useCallback(async (message?: string) => {
    setBusy(true);
    setAccess('signed-out');
    setAccountId('');
    setSection('statistics');
    setError(message);
    try {
      const sdk = await adminSupabase();
      await sdk?.auth.signOut({ scope: 'local' });
    } catch {
      // The protected API still verifies every request after the form is shown.
    } finally {
      try {
        window.sessionStorage.removeItem(ADMIN_AUTH_STORAGE_KEY);
      } catch {
        // Storage may be disabled in this browsing context.
      }
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Administración · Hexfortia';
    const controller = new AbortController();
    void (async () => {
      try {
        const sdk = await adminSupabase();
        const session = (await sdk?.auth.getSession())?.data.session;
        if (controller.signal.aborted) return;
        if (!session) {
          setAccess('signed-out');
          return;
        }
        await adminRequest({ view: 'session' }, controller.signal);
        if (controller.signal.aborted) return;
        setAccountId(session.user.id);
        setAccess('allowed');
      } catch (cause) {
        if (!controller.signal.aborted) {
          await closeSession(
            cause instanceof AdminRequestError ? cause.message : 'No se pudo recuperar la sesión.',
          );
        }
      }
    })();
    return () => controller.abort();
  }, [closeSession]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const values = new FormData(event.currentTarget);
    try {
      const sdk = await adminSupabase();
      if (!sdk) throw new Error('El acceso de administración necesita configurar Supabase.');
      const { data, error } = await sdk.auth.signInWithPassword({
        email: String(values.get('email')).trim(),
        password: String(values.get('password')),
      });
      if (error || !data.session)
        throw new Error('No se pudo iniciar sesión. Revisa el correo y la contraseña.');
      await adminRequest({ view: 'session' });
      setAccountId(data.session.user.id);
      setAccess('allowed');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo iniciar sesión.';
      if (cause instanceof AdminRequestError) await closeSession(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  const onAuthFailure = useCallback(
    (cause: unknown) => {
      if (cause instanceof AdminRequestError && [401, 403].includes(cause.status))
        void closeSession(cause.message);
    },
    [closeSession],
  );
  if (access !== 'allowed')
    return (
      <main className="admin-login">
        <section className="admin-login-panel" aria-labelledby="admin-login-title">
          <div className="admin-brand">
            <img src="/atlas-mark.svg" width="36" height="36" alt="" />
            <span>Hexfortia</span>
          </div>
          <h1 id="admin-login-title">Administración</h1>
          {access === 'checking' ? (
            <p role="status">Comprobando sesión…</p>
          ) : (
            <form className="admin-login-form" onSubmit={(event) => void signIn(event)}>
              <div>
                <label htmlFor="admin-email">Correo electrónico</label>
                <Input
                  id="admin-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                />
              </div>
              <div>
                <label htmlFor="admin-password">Contraseña</label>
                <Input
                  id="admin-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              {error && (
                <p className="admin-error" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" loading={busy}>
                Iniciar sesión
              </Button>
            </form>
          )}
        </section>
      </main>
    );
  const active = sections.find(({ id }) => id === section)!;
  return (
    <div className="admin-layout">
      <a className="admin-skip" href="#admin-content">
        Saltar al contenido
      </a>
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <img src="/atlas-mark.svg" width="36" height="36" alt="" />
          <span>
            Hexfortia<small>Administración</small>
          </span>
        </div>
        <nav aria-label="Administración">
          {sections.map(({ id, label }) => (
            <Button
              key={id}
              variant="ghost"
              aria-current={id === section ? 'page' : undefined}
              onClick={() => setSection(id)}
            >
              {label}
            </Button>
          ))}
        </nav>
        <Button variant="ghost" className="admin-signout" onClick={() => void closeSession()}>
          Cerrar sesión
        </Button>
      </aside>
      <main className="admin-content" id="admin-content" tabIndex={-1}>
        <h1>{active.label}</h1>
        {section === 'statistics' && <AdminStatistics onAuthFailure={onAuthFailure} />}
        {section === 'users' && (
          <AdminUsers
            onAuthFailure={onAuthFailure}
            accountId={accountId}
            onAccountDeleted={() => void closeSession('La cuenta se ha eliminado.')}
          />
        )}
        {section === 'history' && <AdminHistory onAuthFailure={onAuthFailure} />}
      </main>
    </div>
  );
}
