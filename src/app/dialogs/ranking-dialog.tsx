import { useState } from 'react';
import { rankingSummary } from '../../progression';
import { useGame } from '../game-context';
import { GameSelect } from '../components/game-select';
import { DialogClose } from '../components/dialog-close';
import { Button } from '../components/ui/button';

export function RankingDialog() {
  const { snapshot, commands } = useGame();
  const [mode, setMode] = useState<'machine' | 'online'>('machine');
  const [period, setPeriod] = useState<'all' | 'month'>('all');
  const summary = rankingSummary(snapshot.progression, mode, period, new Date().toISOString());
  return (
    <section className="achievements-shell" aria-label="Clasificación">
      <header className="achievements-heading">
        <div>
          <span className="eyebrow">TU PUNTUACIÓN</span>
          <h2>Clasificación</h2>
          <p>Resultados del perfil de este navegador.</p>
        </div>
        <DialogClose label="Cerrar clasificación" />
      </header>
      <div className="achievements-toolbar ranking-controls">
        <div>
          <label htmlFor="ranking-mode">Modalidad</label>
          <GameSelect
            inputId="ranking-mode"
            value={mode}
            options={[
              { value: 'machine', label: 'Contra Hexfortia' },
              { value: 'online', label: 'En línea' },
            ]}
            onChange={setMode}
          />
        </div>
        <div>
          <label htmlFor="ranking-period">Periodo</label>
          <GameSelect
            inputId="ranking-period"
            value={period}
            options={[
              { value: 'all', label: 'Histórica' },
              { value: 'month', label: 'Últimos 30 días' },
            ]}
            onChange={setPeriod}
          />
        </div>
      </div>
      <div className="achievements-list ranking-content">
        {mode === 'online' ? (
          <p>
            Las partidas en línea aún no están disponibles. Tu puntuación inicial es de 1000 puntos.
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
                    <th scope="row">{snapshot.profile.name}</th>
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
              Experto. El factor de ajuste disminuye a medida que juegas.
            </p>
            {period === 'month' && (
              <p>
                La puntuación mensual se calcula desde 1000 con las partidas de los últimos 30 días
                naturales.
              </p>
            )}
            <p>
              La clasificación mundial y los logros TOP requieren perfiles conectados. Las partidas
              locales no tienen Elo.
            </p>
          </>
        )}
      </div>
      <footer className="achievements-footer">
        <span>Tu progreso se guarda en este navegador.</span>
        <Button onClick={commands.closeDialog}>Volver</Button>
      </footer>
    </section>
  );
}
