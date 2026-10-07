import { DialogClose } from '../components/dialog-close';
import { Button } from '../components/ui/button';
import { useState } from 'react';
import { ACHIEVEMENTS } from '../../achievements';
import {
  PROGRESSION_ACHIEVEMENTS,
  TIERS,
  levelProgress,
  progressionValue,
  type ProgressionAchievement,
} from '../../progression';
import { AchievementIcon } from '../components/achievement-icon';
import { ProgressionSummary } from '../components/progression-summary';
import { useGame } from '../game-context';

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendientes' },
  { id: 'unlocked', label: 'Desbloqueados' },
] as const;

const dateFormat = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function AchievementsDialog() {
  const { snapshot, commands } = useGame();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const tier = levelProgress(snapshot.progression.xp).tier;
  const entries = PROGRESSION_ACHIEVEMENTS.filter((entry) => entry.tier <= tier).map(
    (definition) => ({
      definition,
      progress: {
        current: Math.min(definition.target, progressionValue(snapshot.progression, definition)),
        target: definition.target,
        unlocked: Boolean(snapshot.progression.unlockedAt[definition.id]),
        unlockedAt: snapshot.progression.unlockedAt[definition.id] ?? null,
      },
    }),
  );
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
          <p>En local juegas como Cian; las acciones del invitado no suman a tu perfil.</p>
        </div>
        <DialogClose label="Cerrar logros" />
      </header>
      <div className="achievements-collection">
        <ProgressionSummary />
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
          Las acciones suman al instante; las partidas y victorias, al terminar. Las siguientes
          categorías se abren en los niveles 5, 15, 30 y 50.
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
          TIERS.map((category, index) => {
            const group = visible.filter((entry) => entry.definition.tier === index);
            if (!group.length) return null;
            return (
              <section
                key={category.name}
                className="achievements-category"
                aria-labelledby={`achievement-category-${index}`}
              >
                <div className="achievements-category-heading">
                  <h3 id={`achievement-category-${index}`}>{category.name}</h3>
                  <span>+{category.xp} XP por logro</span>
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
                : 'Completa una partida para estrenar tu palmarés.'}
            </p>
            <Button type="button" variant="secondary" onClick={() => setFilter('all')}>
              Ver todos los logros
            </Button>
          </div>
        )}
        {Object.keys(snapshot.progression.legacyUnlockedAt).length > 0 && (
          <details className="legacy-achievements">
            <summary>Logros de la versión anterior</summary>
            <ul>
              {Object.entries(snapshot.progression.legacyUnlockedAt).map(([id, at]) => (
                <li key={id}>
                  {ACHIEVEMENTS.find((entry) => entry.id === id)?.title ?? id} ·{' '}
                  <time dateTime={at}>{dateFormat.format(new Date(at))}</time>
                </li>
              ))}
            </ul>
          </details>
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
  definition: ProgressionAchievement;
  progress: { current: number; target: number; unlocked: boolean; unlockedAt: string | null };
}) {
  const cumulative = progress.target > 1;
  const secret = definition.hidden && !progress.unlocked;
  const modes: readonly string[] = definition.modes;
  return (
    <li
      className={`achievement-row${progress.unlocked ? ' is-unlocked' : ''}`}
      data-achievement-id={definition.id}
    >
      <AchievementIcon
        icon={
          definition.metric === 'transform'
            ? 'transformation'
            : definition.metric === 'tutorial'
              ? 'tutorial-complete'
              : definition.metric === 'wins'
                ? 'first-win'
                : definition.metric === 'kills'
                  ? 'captures-100'
                  : 'first-match'
        }
        unlocked={progress.unlocked}
      />
      <div className="achievement-description">
        <h4>{definition.title}</h4>
        {!secret && <p>{definition.description}</p>}
        {!secret && modes.length > 0 && (
          <div className="achievement-modes" aria-label="Modalidades válidas">
            {modes.map((mode) => {
              const label =
                mode === 'machine'
                  ? `Hexfortia · ${['Fácil', 'Medio', 'Difícil', 'Experto'][definition.minDifficulty]} o superior`
                  : mode === 'online'
                    ? 'En línea · pendiente de esta modalidad'
                    : 'Local · solo Cian';
              return (
                <details key={mode}>
                  <summary title={label} aria-label={label}>
                    {mode === 'machine'
                      ? `⬡ ${['F', 'M', 'D', 'E'][definition.minDifficulty]}`
                      : mode === 'online'
                        ? '◎'
                        : '♙'}
                  </summary>
                  <span>{label}</span>
                </details>
              );
            })}
          </div>
        )}
        {cumulative && !progress.unlocked && !secret && (
          <div className="achievement-progress">
            <progress
              value={progress.current}
              max={progress.target}
              aria-label={`Progreso de ${definition.title}`}
            />
            <span>
              {progress.current} / {progress.target}
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
              {secret ? 'Logro oculto' : 'Pendiente'}
            </>
          )}
        </span>
      </div>
    </li>
  );
}
