import type { PublicPlayerProfile } from '../../ranking-contracts';
import { DialogClose } from '../components/dialog-close';
import { useEffect, useRef, useState } from 'react';
import { fetchPublicProfile } from '../../ranking-client';
import { PROFILE_COLORS, PROFILE_EMBLEMS } from '../../user-profile';
import { useGame } from '../game-context';
import { ProfileAvatar } from '../components/profile-avatar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { plainTabClassName } from '../components/ui/tabs';
import { PROGRESSION_ACHIEVEMENTS, levelProgress, TIERS } from '../../progression';
import { playerRecords, playerStatistics } from '../../profile-statistics';
import { ProgressionSummary } from '../components/progression-summary';
import { AccountStatus } from '../components/account-access';
import { useAccount } from '../account-context';
import { MatchClockNotice } from '../components/match-clock-notice';

const emblemLabels = {
  fortress: 'Fortaleza',
  star: 'Estrella',
  hex: 'Hexágono',
  shield: 'Escudo',
  swords: 'Espadas',
  crown: 'Corona',
  wing: 'Ala',
  flame: 'Llama',
  compass: 'Brújula',
  laurel: 'Laurel',
};
const colorLabels = {
  cyan: 'Cian',
  amber: 'Ámbar',
  mint: 'Menta',
  coral: 'Coral',
  sky: 'Celeste',
  rose: 'Rosa',
  gold: 'Oro',
  silver: 'Plata',
  emerald: 'Esmeralda',
  ivory: 'Marfil',
};

function ProfileSettings() {
  const { account, controller } = useAccount();
  const { snapshot, commands } = useGame();
  const unlockedOptions = (levelProgress(snapshot.progression.xp).tier + 1) * 2;
  const [draft, setDraft] = useState(snapshot.profile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <form
      className="profile-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        void (async () => {
          try {
            const name =
              draft.name.trim() === snapshot.profile.name
                ? draft.name
                : await controller.username(draft.name);
            if (mounted.current) commands.updateProfile({ ...draft, name });
          } catch (cause) {
            if (mounted.current)
              setError(cause instanceof Error ? cause.message : 'No se pudo guardar el nombre.');
          } finally {
            if (mounted.current) setBusy(false);
          }
        })();
      }}
    >
      <p>Elige cómo quieres aparecer en Hexfortia.</p>
      <div className="profile-preview">
        <ProfileAvatar profile={draft} />
        <strong>{draft.name || 'Tu nombre'}</strong>
      </div>
      <label className="profile-name-label" htmlFor="profile-name">
        Nombre de usuario
      </label>
      <Input
        id="profile-name"
        value={draft.name}
        maxLength={24}
        required
        autoComplete="nickname"
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        aria-describedby="profile-name-hint"
      />
      <small id="profile-name-hint">
        Hasta 24 caracteres.{' '}
        {account.user
          ? 'El perfil se guarda en tu cuenta.'
          : 'El perfil se guarda en este navegador.'}
      </small>
      <fieldset>
        <legend>Emblema</legend>
        <div className="profile-options">
          {PROFILE_EMBLEMS.map((emblem, index) => (
            <label
              key={emblem}
              title={
                index >= unlockedOptions
                  ? `Se desbloquea en ${TIERS[Math.floor(index / 2)].name}`
                  : undefined
              }
            >
              <input
                disabled={index >= unlockedOptions}
                type="radio"
                name="profile-emblem"
                aria-label={emblemLabels[emblem]}
                value={emblem}
                checked={draft.emblem === emblem}
                onChange={() => setDraft({ ...draft, emblem })}
              />
              <ProfileAvatar profile={{ ...draft, emblem }} />
              <span>{emblemLabels[emblem]}</span>
              {index >= unlockedOptions && <small>{TIERS[Math.floor(index / 2)].name}</small>}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Color</legend>
        <div className="profile-options">
          {PROFILE_COLORS.map((color, index) => (
            <label
              key={color}
              title={
                index >= unlockedOptions
                  ? `Se desbloquea en ${TIERS[Math.floor(index / 2)].name}`
                  : undefined
              }
            >
              <input
                disabled={index >= unlockedOptions}
                type="radio"
                name="profile-color"
                aria-label={colorLabels[color]}
                value={color}
                checked={draft.color === color}
                onChange={() => setDraft({ ...draft, color })}
              />
              <span className={`profile-swatch profile-${color}`} aria-hidden="true" />
              <span>{colorLabels[color]}</span>
              {index >= unlockedOptions && <small>{TIERS[Math.floor(index / 2)].name}</small>}
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button type="button" onClick={commands.closeDialog}>
          Cancelar
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !draft.name.trim()}
          loading={busy}
        >
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}

const SECTIONS = [
  { id: 'profile', label: 'Tu perfil' },
  { id: 'settings', label: 'Personalizar' },
] as const;
const PROFILE_TABS = [
  { id: 'rating', label: 'Puntuación actual' },
  { id: 'statistics', label: 'Estadísticas' },
  { id: 'records', label: 'Récords' },
] as const;
const MODES = [
  { id: 'online', label: 'En línea' },
  { id: 'machine', label: 'Vs. Hexfortia' },
  { id: 'local', label: 'Local' },
] as const;

export function ProfileDialog({
  publicProfile,
  onBack,
}: {
  publicProfile?: PublicPlayerProfile;
  onBack?: () => void;
}) {
  const { snapshot } = useGame();
  const { account } = useAccount();
  const [rankingView, setRankingView] = useState<{
    id: string;
    data?: PublicPlayerProfile;
    error?: boolean;
  } | null>(null);
  const accountId = account.user?.id;
  useEffect(() => {
    if (publicProfile || !accountId) return;
    const request = new AbortController();
    fetchPublicProfile('me', request.signal).then(
      (data) => {
        if (!request.signal.aborted) setRankingView({ id: accountId, data });
      },
      () => {
        if (!request.signal.aborted) setRankingView({ id: accountId, error: true });
      },
    );
    return () => request.abort();
  }, [publicProfile, accountId]);
  const ownView = rankingView?.id === accountId ? rankingView : null;
  const rankedProfile = publicProfile ?? (accountId ? ownView?.data : undefined);
  const positionLabel = (position: number | null | undefined) =>
    position != null
      ? 'Posición ' + position
      : !publicProfile && accountId && !ownView?.data
        ? ownView?.error
          ? 'Posición no disponible'
          : 'Cargando posición…'
        : 'Sin clasificación';
  const [section, setSection] = useState<(typeof SECTIONS)[number]['id']>('profile');
  const [tab, setTab] = useState<(typeof PROFILE_TABS)[number]['id']>('rating');
  const { progression, profile } = publicProfile ?? snapshot;
  const unlocked = PROGRESSION_ACHIEVEMENTS.filter(
    (entry) => progression.unlockedAt[entry.id],
  ).length;
  return (
    <section
      className="achievements-shell achievements-browser profile-browser"
      aria-label="Perfil de usuario"
    >
      <aside className="achievements-sidebar">
        <header className="achievements-heading">
          <h2>Perfil</h2>
        </header>
        <nav className="achievement-levels" aria-label="Secciones del perfil">
          {SECTIONS.filter((item) => !publicProfile || item.id === 'profile').map((item) => (
            <div className="achievement-level" key={item.id}>
              <button
                type="button"
                aria-current={section === item.id ? 'page' : undefined}
                aria-controls="profile-content"
                onClick={() => setSection(item.id)}
              >
                {publicProfile ? 'Perfil del jugador' : item.label}
              </button>
            </div>
          ))}
        </nav>
        <MatchClockNotice />
        {!publicProfile && <AccountStatus sidebar />}
        {onBack && (
          <Button variant="ghost" onClick={onBack}>
            Volver a clasificación
          </Button>
        )}
      </aside>
      <div className="achievements-main">
        <header className="achievements-profile">
          <button
            type="button"
            className="achievements-player profile-link"
            onClick={() => setSection('profile')}
          >
            <ProfileAvatar profile={profile} xp={progression.xp} />
            <strong>{profile.name}</strong>
          </button>
          <ProgressionSummary showActivity={false} progression={progression} />
          <DialogClose label="Cerrar perfil" />
        </header>
        <div id="profile-content" className="profile-content">
          {section === 'profile' && (
            <>
              <div className="profile-achievements">
                <div>
                  <strong>
                    {unlocked} de {PROGRESSION_ACHIEVEMENTS.length} logros
                  </strong>
                  <span>{Math.round((100 * unlocked) / PROGRESSION_ACHIEVEMENTS.length)}%</span>
                </div>
                <progress
                  value={unlocked}
                  max={PROGRESSION_ACHIEVEMENTS.length}
                  aria-label="Progresión en logros"
                />
                <small className="profile-note">
                  Racha de actividad: {progression.activity.streak} días · Mejor:{' '}
                  {progression.activity.best}
                </small>
              </div>
              <div
                className="flex flex-wrap gap-1 mb-4"
                role="tablist"
                aria-label="Datos del perfil"
              >
                {PROFILE_TABS.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`profile-tab-${item.id}`}
                    aria-selected={tab === item.id}
                    aria-controls={`profile-panel-${item.id}`}
                    tabIndex={tab === item.id ? 0 : -1}
                    className={plainTabClassName}
                    onClick={() => setTab(item.id)}
                    onKeyDown={(event) => {
                      let next = index;
                      if (event.key === 'ArrowRight') next = (index + 1) % PROFILE_TABS.length;
                      else if (event.key === 'ArrowLeft')
                        next = (index + PROFILE_TABS.length - 1) % PROFILE_TABS.length;
                      else if (event.key === 'Home') next = 0;
                      else if (event.key === 'End') next = PROFILE_TABS.length - 1;
                      else return;
                      event.preventDefault();
                      setTab(PROFILE_TABS[next].id);
                      document.getElementById(`profile-tab-${PROFILE_TABS[next].id}`)?.focus();
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div
                role="tabpanel"
                id="profile-panel-rating"
                aria-labelledby="profile-tab-rating"
                hidden={tab !== 'rating'}
                tabIndex={0}
              >
                <dl className="profile-ratings">
                  {MODES.filter((mode) => mode.id !== 'local').map((mode) => (
                    <div key={mode.id}>
                      <dt>{mode.label}</dt>
                      <dd>
                        <strong>{progression.ratings[mode.id]} Elo</strong>
                        <span>{positionLabel(rankedProfile?.positions?.[mode.id])}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div
                role="tabpanel"
                id="profile-panel-statistics"
                aria-labelledby="profile-tab-statistics"
                hidden={tab !== 'statistics'}
                tabIndex={0}
              >
                <div
                  className="ranking-table-scroll"
                  role="region"
                  aria-label="Estadísticas del jugador"
                  tabIndex={0}
                >
                  <table className="ranking-table">
                    <caption>Estadísticas del jugador</caption>
                    <thead>
                      <tr>
                        <th scope="col">Modo</th>
                        {[
                          'Partidas jugadas',
                          'Victorias',
                          'Tablas',
                          'Derrotas',
                          '% de Victorias',
                        ].map((label) => (
                          <th scope="col" key={label}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...MODES, { id: undefined, label: 'Total' }].map((mode) => {
                        const stats = publicProfile
                          ? publicProfile.statistics[mode.id ?? 'total']
                          : playerStatistics(snapshot.progression, mode.id);
                        return (
                          <tr key={mode.label}>
                            <th scope="row">{mode.label}</th>
                            <td>{stats.played}</td>
                            <td>{stats.wins}</td>
                            <td>{stats.draws}</td>
                            <td>{stats.losses}</td>
                            <td>
                              {stats.winPercentage.toLocaleString('es-ES', {
                                maximumFractionDigits: 1,
                              })}
                              %
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div
                role="tabpanel"
                id="profile-panel-records"
                aria-labelledby="profile-tab-records"
                hidden={tab !== 'records'}
                tabIndex={0}
              >
                <div
                  className="ranking-table-scroll"
                  role="region"
                  aria-label="Récords del jugador"
                  tabIndex={0}
                >
                  <table className="ranking-table">
                    <caption>Récords del jugador</caption>
                    <thead>
                      <tr>
                        <th scope="col">Modo</th>
                        {[
                          'Mejor puntuación',
                          'Mejor posición en la clasificación mensual',
                          'Mejor posición en la clasificación histórica',
                          'Mayor racha de victorias consecutivas',
                        ].map((label) => (
                          <th scope="col" key={label}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {MODES.filter((mode) => mode.id !== 'local').map((mode) => {
                        const records = rankedProfile
                          ? rankedProfile.records[mode.id]
                          : playerRecords(snapshot.progression, mode.id);
                        return (
                          <tr key={mode.id}>
                            <th scope="row">{mode.label}</th>
                            <td>{records.bestRating}</td>
                            <td>{positionLabel(records.monthlyPosition)}</td>
                            <td>{positionLabel(records.historicalPosition)}</td>
                            <td>{records.bestStreak}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              {tab !== 'rating' && (
                <p className="ranking-scroll-hint">Desliza la tabla para ver todas las columnas.</p>
              )}
            </>
          )}
          {!publicProfile && section === 'settings' && <ProfileSettings />}
        </div>
      </div>
    </section>
  );
}
