import { useEffect, useState } from 'react';
import { fetchPublicProfile } from '../../ranking-client';
import type { PublicPlayerProfile } from '../../ranking-contracts';
import { ProfileDialog } from './profile-dialog';
import { useGame } from '../game-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { DialogClose } from '../components/dialog-close';
import { ProfileAvatar } from '../components/profile-avatar';
import { ProgressionSummary } from '../components/progression-summary';
import { MatchClockNotice } from '../components/match-clock-notice';
import { Button } from '../components/ui/button';
import { useAccount } from '../account-context';

export function RankingDialog() {
  const { snapshot, commands } = useGame();
  const { controller } = useAccount();
  const { query, data, busy, error, shared } = snapshot.ranking;
  const { mode, period, page } = query;
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [view, setView] = useState<{ data?: PublicPlayerProfile; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!playerId) return;
    const request = new AbortController();
    fetchPublicProfile(playerId, request.signal).then(
      (data) => {
        if (!request.signal.aborted) setView({ data });
      },
      () => {
        if (!request.signal.aborted)
          setView({ error: 'No se pudo cargar el perfil. Vuelve a intentarlo.' });
      },
    );
    return () => request.abort();
  }, [playerId, attempt]);
  if (playerId) {
    if (view.data)
      return <ProfileDialog publicProfile={view.data} onBack={() => setPlayerId(null)} />;
    return (
      <section aria-label="Perfil de usuario">
        <DialogClose label="Cerrar perfil" className="dialog-corner-close" />
        <h2>Perfil del jugador</h2>
        {view.error ? (
          <>
            <p role="alert">{view.error}</p>
            <Button
              onClick={() => {
                setView({});
                setAttempt((value) => value + 1);
              }}
            >
              Reintentar
            </Button>
          </>
        ) : (
          <p role="status">Cargando perfil…</p>
        )}
        <Button onClick={() => setPlayerId(null)}>Volver a clasificación</Button>
      </section>
    );
  }
  return (
    <section
      className="achievements-shell achievements-browser ranking-browser"
      aria-label="Clasificación"
    >
      <aside className="achievements-sidebar">
        <header className="achievements-heading">
          <h2>Clasificación</h2>
        </header>
        <nav className="achievement-levels" aria-label="Modalidad de clasificación">
          {(
            [
              { id: 'online', label: 'En línea' },
              { id: 'machine', label: 'Vs. Hexfortia' },
            ] as const
          ).map((item) => (
            <div className="achievement-level" key={item.id}>
              <button
                type="button"
                aria-current={mode === item.id ? 'page' : undefined}
                onClick={() => {
                  commands.loadRanking({ mode: item.id, period: 'month', page: 0 });
                }}
              >
                {item.label}
              </button>
            </div>
          ))}
        </nav>
        <MatchClockNotice />
      </aside>
      <div className="achievements-main">
        <header className="achievements-profile">
          <button
            type="button"
            className="achievements-player profile-link"
            onClick={() => commands.openDialog({ kind: 'profile' })}
          >
            <ProfileAvatar profile={snapshot.profile} />
            <strong>{snapshot.profile.name}</strong>
          </button>
          <ProgressionSummary showActivity={false} />
          <DialogClose label="Cerrar clasificación" />
        </header>
        <Tabs
          value={period}
          onValueChange={(value) =>
            commands.loadRanking({ mode, period: value as 'month' | 'all', page: 0 })
          }
          className="ranking-periods"
        >
          <TabsList
            className="achievements-toolbar flex flex-wrap gap-1"
            aria-label="Periodo de clasificación"
          >
            <TabsTrigger value="month" variant="plain">
              Mensual
            </TabsTrigger>
            <TabsTrigger value="all" variant="plain">
              Histórica
            </TabsTrigger>
          </TabsList>
          <TabsContent key={period} value={period} className="achievements-list ranking-content">
            {!shared && (
              <p>
                Tus resultados en este navegador. Tu perfil de invitado no aparece en la
                clasificación compartida.
              </p>
            )}
            <Button
              className="mb-4"
              size="compact"
              onClick={() => commands.loadRanking()}
              disabled={busy}
            >
              Actualizar clasificación
            </Button>
            {busy && <p role="status">Cargando clasificación…</p>}
            {error && <p role="alert">{error}</p>}
            {data && data.total === 0 && (
              <p role="status">
                Todavía no hay jugadores con partidas completadas en este periodo.
              </p>
            )}
            {data && data.entries.length > 0 && (
              <>
                <div
                  className="ranking-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Resultados de clasificación"
                >
                  <table className="ranking-table">
                    <caption>
                      {period === 'all'
                        ? 'Clasificación histórica'
                        : 'Clasificación de los últimos 30 días'}
                    </caption>
                    <thead>
                      <tr>
                        {[
                          'Posición',
                          'Usuario',
                          'Partidas jugadas',
                          'Victorias',
                          'Tablas',
                          'Derrotas',
                          'Puntuación',
                        ].map((name) => (
                          <th key={name} scope="col">
                            {name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.entries.map((entry) => (
                        <tr key={entry.position}>
                          <td>
                            {shared ? (
                              entry.position
                            ) : (
                              <span aria-label="Sin posición compartida">—</span>
                            )}
                          </td>
                          <th scope="row">
                            <button
                              type="button"
                              className="profile-link inline-flex items-center gap-3"
                              onClick={() => {
                                if (shared && entry.playerId) {
                                  setView({});
                                  setPlayerId(entry.playerId);
                                } else commands.openDialog({ kind: 'profile' });
                              }}
                              aria-label={entry.name}
                              title={'Ver perfil de ' + entry.name}
                              disabled={shared && !entry.playerId}
                            >
                              <ProfileAvatar
                                xp={shared ? (entry.xp ?? 0) : snapshot.progression.xp}
                                profile={
                                  entry.profile ??
                                  (shared
                                    ? { name: entry.name, emblem: 'fortress', color: 'cyan' }
                                    : snapshot.profile)
                                }
                              />
                              <span>{entry.name}</span>
                            </button>
                          </th>
                          <td>{entry.played}</td>
                          <td>{entry.wins}</td>
                          <td>{entry.draws}</td>
                          <td>{entry.losses}</td>
                          <td>
                            <strong>{entry.rating}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="ranking-scroll-hint">Desliza la tabla para ver todas las columnas.</p>
              </>
            )}
            {!shared && (
              <div className="mt-4 grid gap-3">
                <p className="m-0 text-muted">
                  Crea una cuenta o inicia sesión para consultar la clasificación completa.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="compact"
                    variant="primary"
                    onClick={() => controller.open('signup')}
                  >
                    Crear cuenta
                  </Button>
                  <Button size="compact" onClick={() => controller.open('signin')}>
                    Iniciar sesión
                  </Button>
                </div>
              </div>
            )}
            <nav
              aria-label="Páginas de clasificación"
              className="mt-4 flex flex-wrap items-center gap-3"
              hidden={!shared || (!busy && !data?.total)}
            >
              <Button
                size="compact"
                disabled={busy || page === 0}
                onClick={() => commands.loadRanking({ ...query, page: page - 1 })}
              >
                Anterior
              </Button>
              <span aria-live="polite">
                Página {page + 1}
                {data
                  ? ' de ' +
                    Math.max(1, Math.ceil(data.total / data.pageSize)) +
                    ' · ' +
                    data.total +
                    ' jugadores'
                  : ''}
              </span>
              <Button
                size="compact"
                disabled={busy || !data || (page + 1) * data.pageSize >= data.total}
                onClick={() => commands.loadRanking({ ...query, page: page + 1 })}
              >
                Siguiente
              </Button>
            </nav>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
