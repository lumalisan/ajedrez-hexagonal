import type { ProgressionMode } from '../../progression';

export function ModeIcon({ mode }: { mode: ProgressionMode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {mode === 'machine' ? (
        <>
          <path d="m12 2 8.5 5v10L12 22l-8.5-5V7Z" />
          <path d="m12 7 4.3 2.5v5L12 17l-4.3-2.5v-5ZM12 2v5m8.5 0-4.2 2.5m4.2 7.5-4.2-2.5M12 22v-5m-8.5 0 4.2-2.5M3.5 7l4.2 2.5" />
        </>
      ) : mode === 'online' ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <path d="M3 12h18M5 6.5h14M5 17.5h14" />
        </>
      ) : (
        <>
          <circle cx="8" cy="7" r="3" />
          <path d="M2.5 20v-3a5.5 5.5 0 0 1 11 0v3ZM16 4a3 3 0 0 1 0 6m1 3a5.5 5.5 0 0 1 4.5 5.4V20H17" />
        </>
      )}
    </svg>
  );
}
