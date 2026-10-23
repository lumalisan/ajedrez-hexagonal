import { DialogClose } from '../components/dialog-close';
import { Button } from '../components/ui/button';
import { plainTabClassName } from '../components/ui/tabs';
import { useState } from 'react';
import { ProfileAvatar } from '../components/profile-avatar';
import {
  PROGRESSION_ACHIEVEMENTS,
  TIERS,
  levelProgress,
  progressionValue,
  achievementShowsProgress,
  type ProgressionAchievement,
} from '../../progression';
import { AchievementIcon } from '../components/achievement-icon';
import { AchievementModes } from '../components/achievement-modes';
import { ProgressionSummary } from '../components/progression-summary';
import { useGame } from '../game-context';
import { AccountStatus } from '../components/account-access';

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
  const { tier } = levelProgress(snapshot.progression.xp);
  const [selectedTier, setSelectedTier] = useState<number | 'all'>(0);
  const [lockedHint, setLockedHint] = useState<number | null>(null);
  const category = selectedTier === 'all' ? null : TIERS[selectedTier];
  const entries = PROGRESSION_ACHIEVEMENTS.filter(
    (entry) => selectedTier === 'all' || entry.tier === selectedTier,
  ).map((definition) => ({
    definition,
    progress: {
      current: Math.min(definition.target, progressionValue(snapshot.progression, definition)),
      target: definition.target,
      unlocked: Boolean(snapshot.progression.unlockedAt[definition.id]),
      unlockedAt: snapshot.progression.unlockedAt[definition.id] ?? null,
    },
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
    <section className="achievements-shell achievements-browser" aria-label="Colección de logros">
      <aside className="achievements-sidebar">
        <header className="achievements-heading">
          <h2>Logros</h2>
        </header>
        <nav aria-label="Niveles de logros" className="achievement-levels">
          {TIERS.map((entry, index) => {
            const locked = index > tier;
            const hint = `Llega al nivel ${entry.level} para desbloquear este nivel`;
            return (
              <div key={entry.name} className="achievement-level">
                <button
                  type="button"
                  aria-current={selectedTier === index ? 'page' : undefined}
                  aria-disabled={locked}
                  aria-describedby={locked ? `achievement-level-hint-${index}` : undefined}
                  data-achievement-tier={index}
                  onClick={() => {
                    if (locked) setLockedHint(lockedHint === index ? null : index);
                    else {
                      setSelectedTier(index);
                      setLockedHint(null);
                    }
                  }}
                >
                  <span>Nivel {entry.name}</span>
                  {locked && (
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M4 7V5a4 4 0 0 1 8 0v2M3 7h10v7H3zM8 10v1" />
                    </svg>
                  )}
                </button>
                {locked && (
                  <span
                    id={`achievement-level-hint-${index}`}
                    className="achievement-level-hint"
                    data-open={lockedHint === index}
                    role="tooltip"
                  >
                    {hint}
                  </span>
                )}
              </div>
            );
          })}
          <div className="achievement-level">
            <button
              type="button"
              aria-current={selectedTier === 'all' ? 'page' : undefined}
              data-achievement-tier="all"
              onClick={() => {
                setSelectedTier('all');
                setLockedHint(null);
              }}
            >
              Todos los niveles
            </button>
          </div>
        </nav>
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
          <DialogClose label="Cerrar logros" />
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
                className={plainTabClassName}
                aria-pressed={filter === item.id}
                data-achievement-filter={item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <span className="achievements-result-count" role="status">
            {category
              ? `+${category.xp} XP por logro`
              : 'Todos los niveles · Incluye logros ocultos'}
          </span>
        </div>
        <div className="achievements-list" tabIndex={0} aria-label="Lista de logros">
          {visible.length ? (
            <section className="achievements-category" aria-labelledby="achievement-category-title">
              <h3 id="achievement-category-title" className="sr-only">
                {category?.name ?? 'Todos los niveles'}
              </h3>
              <ul>
                {visible.map(({ definition, progress }) => (
                  <AchievementRow
                    key={definition.id}
                    definition={definition}
                    progress={progress}
                    revealHidden={selectedTier === 'all'}
                  />
                ))}
              </ul>
            </section>
          ) : (
            <div className="achievements-empty">
              <AchievementIcon
                icon={filter === 'pending' ? 'p2-02' : 'p1-04'}
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
        </div>
      </div>
    </section>
  );
}

function AchievementRow({
  definition,
  progress,
  revealHidden,
}: {
  definition: ProgressionAchievement;
  progress: { current: number; target: number; unlocked: boolean; unlockedAt: string | null };
  revealHidden: boolean;
}) {
  const cumulative = achievementShowsProgress(definition);
  const secret = definition.hidden && !progress.unlocked && !revealHidden;
  return (
    <li
      className={`achievement-row${progress.unlocked ? ' is-unlocked' : ''}`}
      data-achievement-id={definition.id}
    >
      <div className="achievement-art">
        <AchievementIcon icon={definition.id} unlocked={progress.unlocked} />
      </div>
      <div className="achievement-description">
        <h4>{definition.title}</h4>
        {revealHidden && (
          <small>
            Nivel {TIERS[definition.tier].name} · +{TIERS[definition.tier].xp} XP
          </small>
        )}
        {!secret && <p>{definition.description}</p>}
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
      <AchievementModes
        modes={definition.modes}
        minDifficulty={definition.minDifficulty}
        metric={definition.metric}
      />
    </li>
  );
}
