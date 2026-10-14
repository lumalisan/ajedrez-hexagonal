import { DialogClose } from '../components/dialog-close';
import { useState } from 'react';
import { PROFILE_COLORS, PROFILE_EMBLEMS } from '../../user-profile';
import { useGame } from '../game-context';
import { ProfileAvatar } from '../components/profile-avatar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { PROGRESSION_ACHIEVEMENTS } from '../../progression';
import { playerRecords, playerStatistics } from '../../profile-statistics';
import { ProgressionSummary } from '../components/progression-summary';

const emblemLabels = { fortress: 'Fortaleza', star: 'Estrella', hex: 'Hexágono' };
const colorLabels = { cyan: 'Cian', amber: 'Ámbar', mint: 'Menta' };

function ProfileSettings() {
  const { snapshot, commands } = useGame();
  const [draft, setDraft] = useState(snapshot.profile);
  return (
    <form
      className="profile-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.name.trim()) commands.updateProfile(draft);
      }}
    >
      <h3>Configuración</h3>
      <p>Elige cómo quieres aparecer en Protocolo Hexagonal.</p>
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
          {PROFILE_EMBLEMS.map((emblem) => (
            <label key={emblem}>
              <input
                type="radio"
                name="profile-emblem"
                value={emblem}
                checked={draft.emblem === emblem}
                onChange={() => setDraft({ ...draft, emblem })}
              />
              <ProfileAvatar profile={{ ...draft, emblem }} />
              <span>{emblemLabels[emblem]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Color</legend>
        <div className="profile-options">
          {PROFILE_COLORS.map((color) => (
            <label key={color}>
              <input
                type="radio"
                name="profile-color"
                value={color}
                checked={draft.color === color}
                onChange={() => setDraft({ ...draft, color })}
              />
              <span className={`profile-swatch profile-${color}`} aria-hidden="true" />
              <span>{colorLabels[color]}</span>
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
  { id: 'statistics', label: 'Estadísticas y récords' },
  { id: 'settings', label: 'Configuración' },
] as const;
const MODES = [
  { id: 'online', label: 'En línea' },
  { id: 'machine', label: 'Vs. Hexfortia' },
  { id: 'local', label: 'Local' },
] as const;

export function ProfileDialog() {
  const { snapshot, commands } = useGame();
  const [section, setSection] = useState<(typeof SECTIONS)[number]['id']>('profile');
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
        <header className="achievements-profile profile-header">
          <div className="achievements-player">
            <ProfileAvatar profile={profile} />
            <strong>{profile.name}</strong>
          </div>
          <DialogClose label="Cerrar perfil" />
        </header>
        <div id="profile-content" className="profile-content">
          {section === 'profile' && (
            <>
              <h3>Tu perfil</h3>
              <ProgressionSummary />
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
                <Button onClick={() => commands.openDialog({ kind: 'achievements' })}>
                  Ver logros
                </Button>
              </div>
              <h3>Puntuación y clasificación</h3>
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
                Las posiciones requieren una clasificación compartida. Las partidas en línea aún no
                están disponibles.
              </p>
            </>
          )}
          {section === 'statistics' && (
            <>
              <h3>Estadísticas y récords</h3>
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
              <div
                className="ranking-table-scroll profile-records"
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
              <p className="ranking-scroll-hint">Desliza las tablas para ver todas las columnas.</p>
              <p className="profile-note">
                Solo cuentan las partidas terminadas. Los guardados antiguos sin resultado conservan
                el número de partidas, sin asignarles victorias, tablas o derrotas. Las posiciones
                requieren una clasificación compartida.
              </p>
            </>
          )}
          {section === 'settings' && <ProfileSettings />}
        </div>
      </div>
    </section>
  );
}
