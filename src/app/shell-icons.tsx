import { useGame } from './game-context';

export function SettingsIcon() {
  return (
    <svg className="settings-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 7h10m4 0h2M4 17h2m4 0h10M14 4v6M6 14v6" />
      <circle cx="14" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

export function SoundButton({ home = false }: { home?: boolean }) {
  const {
    snapshot: { preferences },
    commands,
  } = useGame();
  const label = preferences.sound ? 'Silenciar sonido' : 'Activar sonido';
  return (
    <button
      className={`icon-button${preferences.sound ? '' : ' muted'}`}
      id={home ? 'home-sound-button' : 'sound-button'}
      type="button"
      aria-label={label}
      aria-pressed={!preferences.sound}
      title={label}
      onClick={commands.toggleSound}
    >
      <svg className="sound-icon" aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 9.5v5h4l4.5 3.5V6L8 9.5H4Z" />
        <path className="sound-wave sound-wave-1" d="M15 9a4 4 0 0 1 0 6" />
        <path className="sound-wave sound-wave-2" d="M17.5 6.5a7.5 7.5 0 0 1 0 11" />
        <path className="sound-muted-mark" d="m16 9 5 6m0-6-5 6" />
      </svg>
      {home && <span className="home-utility-label">Sonido</span>}
    </button>
  );
}
