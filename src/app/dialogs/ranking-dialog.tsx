import { useGame } from '../game-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { DialogClose } from '../components/dialog-close';
import { ProfileAvatar } from '../components/profile-avatar';
import { ProgressionSummary } from '../components/progression-summary';
import { AccountStatus } from '../components/account-access';
import { MatchClockNotice } from '../components/match-clock-notice';
import { Button } from '../components/ui/button';

export function RankingDialog() {
  const { snapshot, commands } = useGame();
  const { query, data, busy, error } = snapshot.ranking;
  const { mode, period, page } = query;
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
        <AccountStatus sidebar showSignOut={false} />
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
            <p>
              Clasificación compartida de todos los jugadores con partidas completadas.
              {mode === 'machine'
                ? ' Los resultados contra Hexfortia se publican al sincronizar el progreso de tu cuenta.'
                : ' Solo cuentan las partidas públicas; el servidor calcula el Elo.'}
            </p>
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
                          <td>{entry.position}</td>
                          <th scope="row">{entry.name}</th>
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
            <nav
              aria-label="Páginas de clasificación"
              className="mt-4 flex flex-wrap items-center gap-3"
              hidden={!busy && !data?.total}
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
