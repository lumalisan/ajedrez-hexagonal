import { Button } from '../components/ui/button';
import { useState } from 'react';
import {
  ACHIEVEMENTS,
  achievementProgressFor,
  type AchievementDefinition,
} from '../../achievements';
import { AchievementIcon } from '../components/achievement-icon';
import { useGame } from '../game-context';

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'unlocked', label: 'Desbloqueados' },
] as const;

const CATEGORIES = [
  { id: 'matches', label: 'En el campo de batalla', detail: 'Partidas y victorias' },
  { id: 'tactics', label: 'Con un poco de malicia', detail: 'Hazañas tácticas' },
  { id: 'academy', label: 'La práctica hace al estratega', detail: 'Academia' },
] as const;

const dateFormat = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function AchievementsDialog() {
  const { snapshot, commands } = useGame();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const entries = ACHIEVEMENTS.map((definition) => ({
    definition,
    progress: achievementProgressFor(definition, snapshot.achievements),
  }));
  const unlocked = entries.filter((entry) => entry.progress.unlocked).length;
  const percentage = Math.round((unlocked / entries.length) * 100);
  const clockRunning =
    !snapshot.homeView &&
    !snapshot.state.outcome &&
    snapshot.replayCursor === null &&
    snapshot.matchRecord?.clock?.status === 'running';
  const visible = entries.filter(
    (entry) =>
      filter === 'all' ||
      (filter === 'unlocked' ? entry.progress.unlocked : !entry.progress.unlocked),
  );

  return (
    <section className="achievements-shell" aria-label="Colección de logros">
      <header className="achievements-heading">
        <div>
          <span className="eyebrow">TU PALMARÉS</span>
          <h2>Logros</h2>
          <p>Perfil compartido: en local cuentan ambos bandos; contra la IA, solo el humano.</p>
        </div>
        <button
          type="button"
          className="icon-button achievement-close"
          aria-label="Cerrar logros"
          data-dialog-close
          onClick={commands.closeDialog}
        >
          <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
        </button>
      </header>
      <div className="achievements-collection">
        <div>
          <span>
            <strong>{unlocked}</strong> de {entries.length} logros desbloqueados
          </span>
          <span>{percentage}%</span>
        </div>
        <progress
          value={unlocked}
          max={entries.length}
          aria-label="Logros desbloqueados"
          data-achievement-summary
        />
        <p className="achievements-scope">
          Las acciones suman al instante; las partidas y victorias, al terminar.
          {clockRunning && <strong> El reloj de la partida sigue en marcha.</strong>}
        </p>
      </div>
      <div className="achievements-toolbar">
        <div
          className="achievement-filters flex flex-wrap gap-1"
          role="group"
          aria-label="Filtrar logros"
        >
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="min-h-11 cursor-pointer rounded-control border border-transparent bg-transparent px-3 py-2 font-ui text-sm font-semibold text-muted transition-colors hover:bg-panel-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan aria-pressed:border-line-strong aria-pressed:bg-panel-raised aria-pressed:text-ink"
              aria-pressed={filter === item.id}
              data-achievement-filter={item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="achievements-result-count" role="status">
          {visible.length} logros
        </span>
      </div>
      <div className="achievements-list" tabIndex={0} aria-label="Lista de logros">
        {visible.length ? (
          CATEGORIES.map((category) => {
            const group = visible.filter((entry) => entry.definition.category === category.id);
            if (!group.length) return null;
            return (
              <section
                key={category.id}
                className="achievements-category"
                aria-labelledby={`achievement-category-${category.id}`}
              >
                <div className="achievements-category-heading">
                  <h3 id={`achievement-category-${category.id}`}>{category.label}</h3>
                  <span>{category.detail}</span>
                </div>
                <ul>
                  {group.map(({ definition, progress }) => (
                    <AchievementRow
                      key={definition.id}
                      definition={definition}
                      progress={progress}
                    />
                  ))}
                </ul>
              </section>
            );
          })
        ) : (
          <div className="achievements-empty">
            <AchievementIcon
              icon={filter === 'pending' ? 'wins-10' : 'first-win'}
              unlocked={filter === 'pending'}
            />
            <h3>{filter === 'pending' ? '¡Vaya colección!' : 'Tu primera hazaña te espera'}</h3>
            <p>
              {filter === 'pending'
                ? 'Has desbloqueado todos los logros. El tablero sigue teniendo sorpresas.'
                : 'Completa una partida o un ejercicio de la Academia para estrenar tu palmarés.'}
            </p>
            <Button type="button" variant="secondary" onClick={() => setFilter('all')}>
              Ver todos los logros
            </Button>
          </div>
        )}
      </div>
      <footer className="achievements-footer">
        <span>Tu progreso se guarda en este navegador.</span>
        <Button type="button" variant="secondary" data-dialog-close onClick={commands.closeDialog}>
          {snapshot.homeView ? 'Volver al menú' : 'Volver al juego'}
        </Button>
      </footer>
    </section>
  );
}

function AchievementRow({
  definition,
  progress,
}: {
  definition: AchievementDefinition;
  progress: ReturnType<typeof achievementProgressFor>;
}) {
  const cumulative = progress.target > 1;
  return (
    <li
      className={`achievement-row${progress.unlocked ? ' is-unlocked' : ''}`}
      data-achievement-id={definition.id}
    >
      <AchievementIcon icon={definition.icon} unlocked={progress.unlocked} />
      <div className="achievement-description">
        <h4>{definition.title}</h4>
        <p>{definition.description}</p>
        {cumulative && !progress.unlocked && (
          <div className="achievement-progress">
            <progress
              value={progress.current}
              max={progress.target}
              aria-label={`Progreso de ${definition.title}`}
            />
            <span>
              {progress.current} / {progress.target} {definition.unit}
            </span>
          </div>
        )}
        <span className={`achievement-state${progress.unlocked ? ' is-unlocked' : ''}`}>
          {progress.unlocked ? (
            <>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m3 8 3 3 7-7" />
              </svg>
              Desbloqueado
              {progress.unlockedAt && (
                <>
                  {' '}
                  ·{' '}
                  <time dateTime={progress.unlockedAt}>
                    {dateFormat.format(new Date(progress.unlockedAt))}
                  </time>
                </>
              )}
            </>
          ) : (
            <>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M4 7V5a4 4 0 0 1 8 0v2M3 7h10v7H3zM8 10v1" />
              </svg>
              Pendiente
            </>
          )}
        </span>
      </div>
    </li>
  );
}
