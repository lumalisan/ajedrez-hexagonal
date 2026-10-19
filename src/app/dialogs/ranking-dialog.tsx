import { useState } from 'react';
import { rankingSummary } from '../../progression';
import { useGame } from '../game-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { DialogClose } from '../components/dialog-close';
import { Button } from '../components/ui/button';

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
        <p className="achievements-sidebar-note">Resultados del perfil de este navegador.</p>
      </aside>
      <div className="achievements-main">
        <header className="achievements-profile">
          <h3 className="m-0 flex-1">{mode === 'online' ? 'En línea' : 'Vs. Hexfortia'}</h3>
          <DialogClose label="Cerrar clasificación" />
        </header>
        <Tabs
          value={period}
          onValueChange={(value) => setPeriod(value as 'month' | 'all')}
          className="ranking-periods"
        >
          <TabsList
            className="achievements-toolbar flex gap-2"
            aria-label="Periodo de clasificación"
          >
            <TabsTrigger value="month">Mensual</TabsTrigger>
            <TabsTrigger value="all">Histórica</TabsTrigger>
          </TabsList>
          <TabsContent key={period} value={period} className="achievements-list ranking-content">
            {mode === 'online' ? (
              <p>
                Las partidas en línea aún no están disponibles. Tu puntuación inicial es de 1000
                puntos.
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
                <p className="ranking-scroll-hint">Desliza la tabla para ver todas las columnas.</p>
                <p>
                  Hexfortia equivale a 600 puntos en Fácil, 1000 en Medio, 1400 en Difícil y 1800 en
                  Experto. Neuronal comparte provisionalmente la valoración y las recompensas de
                  Experto. El factor de ajuste disminuye a medida que juegas.
                </p>
                {period === 'month' && (
                  <p>
                    La puntuación mensual se calcula desde 1000 con las partidas de los últimos 30
                    días naturales.
                  </p>
                )}
                <p>
                  La clasificación mundial y los logros TOP requieren perfiles conectados. Las
                  partidas locales no tienen Elo.
                </p>
              </>
            )}
          </TabsContent>
        </Tabs>
        <footer className="achievements-footer">
          <span>Tu progreso se guarda en este navegador.</span>
          <Button onClick={commands.closeDialog}>Volver</Button>
        </footer>
      </div>
    </section>
  );
}
