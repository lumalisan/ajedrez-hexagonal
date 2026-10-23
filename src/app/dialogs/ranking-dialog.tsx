import { useState } from 'react';
import { rankingSummary } from '../../progression';
import { useGame } from '../game-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { DialogClose } from '../components/dialog-close';
import { ProfileAvatar } from '../components/profile-avatar';
import { ProgressionSummary } from '../components/progression-summary';
import { AccountStatus } from '../components/account-access';
import { MatchClockNotice } from '../components/match-clock-notice';

export function RankingDialog() {
  const { snapshot, commands } = useGame();
  const [mode, setMode] = useState<'machine' | 'online'>('online');
  const [period, setPeriod] = useState<'all' | 'month'>('month');
  const summary = rankingSummary(snapshot.progression, mode, period, new Date().toISOString());
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
                  setMode(item.id);
                  setPeriod('month');
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
          onValueChange={(value) => setPeriod(value as 'month' | 'all')}
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
            {mode === 'online' ? (
              <p>
                Tu puntuación en línea es de {snapshot.progression.ratings.online} Elo. Las partidas
                públicas actualizan este valor; la clasificación compartida todavía no está
                disponible.
              </p>
            ) : (
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
                      <tr>
                        <th scope="row">
                          <button
                            type="button"
                            className="profile-link"
                            onClick={() => commands.openDialog({ kind: 'profile' })}
                          >
                            {snapshot.profile.name}
                          </button>
                        </th>
                        <td>{summary.played}</td>
                        <td>{summary.wins}</td>
                        <td>{summary.draws}</td>
                        <td>{summary.losses}</td>
                        <td>
                          <strong>{summary.rating}</strong>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}
