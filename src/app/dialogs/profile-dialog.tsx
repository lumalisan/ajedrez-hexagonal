import { useState } from 'react';
import { PROFILE_COLORS, PROFILE_EMBLEMS } from '../../user-profile';
import { useGame } from '../game-context';
import { ProfileAvatar } from '../components/profile-avatar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ProgressionSummary } from '../components/progression-summary';

const emblemLabels = { fortress: 'Fortaleza', star: 'Estrella', hex: 'Hexágono' };
const colorLabels = { cyan: 'Cian', amber: 'Ámbar', mint: 'Menta' };

export function ProfileDialog() {
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
      <h2>Tu perfil</h2>
      <p>Elige cómo quieres aparecer en Protocolo Hexagonal.</p>
      <ProgressionSummary />
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
          Guardar perfil
        </Button>
      </div>
    </form>
  );
}
