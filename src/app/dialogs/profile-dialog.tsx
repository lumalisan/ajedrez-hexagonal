import { DialogClose } from '../components/dialog-close';
import { useState } from 'react';
import { PROFILE_COLORS, PROFILE_EMBLEMS } from '../../user-profile';
import { useGame } from '../game-context';
import { ProfileAvatar } from '../components/profile-avatar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { plainTabClassName } from '../components/ui/tabs';
import { PROGRESSION_ACHIEVEMENTS, levelProgress, TIERS } from '../../progression';
import { playerRecords, playerStatistics } from '../../profile-statistics';
import { ProgressionSummary } from '../components/progression-summary';

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
  const { snapshot, commands } = useGame();
  const unlockedOptions = (levelProgress(snapshot.progression.xp).tier + 1) * 2;
  const [draft, setDraft] = useState(snapshot.profile);
  return (
    <form
      className="profile-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.name.trim()) commands.updateProfile(draft);
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
        Hasta 24 caracteres. El perfil se guarda en este navegador.
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
      <div className="dialog-actions">
        <Button type="button" onClick={commands.closeDialog}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={!draft.name.trim()}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}

const SECTIONS = [
  { id: 'profile', label: 'Tu perfil' },
  { id: 'settings', label: 'Configuración' },
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

export function ProfileDialog() {
  const { snapshot } = useGame();
  const [section, setSection] = useState<(typeof SECTIONS)[number]['id']>('profile');
  const [tab, setTab] = useState<(typeof PROFILE_TABS)[number]['id']>('rating');
  const { progression, profile } = snapshot;
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
          {SECTIONS.map((item) => (
            <div className="achievement-level" key={item.id}>
              <button
                type="button"
                aria-current={section === item.id ? 'page' : undefined}
                aria-controls="profile-content"
                onClick={() => setSection(item.id)}
              >
                {item.label}
              </button>
            </div>
          ))}
        </nav>
        <p className="achievements-sidebar-note">
          Tu perfil y progreso se guardan en este navegador.
        </p>
      </aside>
      <div className="achievements-main">
        <header className="achievements-profile">
          <button
            type="button"
            className="achievements-player profile-link"
            onClick={() => setSection('profile')}
          >
            <ProfileAvatar profile={profile} />
            <strong>{profile.name}</strong>
          </button>
          <ProgressionSummary showActivity={false} />
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
                aria-label="Datos de tu perfil"
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
                        <span>Posición actual: Sin clasificación</span>
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="profile-note">
                  Las posiciones requieren una clasificación compartida. El Elo en línea se
                  actualiza al terminar partidas públicas con el servidor conectado.
                </p>
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
                        const stats = playerStatistics(progression, mode.id);
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
                        const records = playerRecords(progression, mode.id);
                        return (
                          <tr key={mode.id}>
                            <th scope="row">{mode.label}</th>
                            <td>{records.bestRating}</td>
                            <td>Sin clasificación</td>
                            <td>Sin clasificación</td>
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
          {section === 'settings' && <ProfileSettings />}
        </div>
      </div>
    </section>
  );
}
