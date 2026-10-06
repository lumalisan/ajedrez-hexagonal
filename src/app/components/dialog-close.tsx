import { useGame } from '../game-context';

/** The same close target and glyph for every dialog. */
export function DialogClose({ label, className = '' }: { label: string; className?: string }) {
  const { commands } = useGame();
  return (
    <button
      type="button"
      className={`icon-button achievement-close ${className}`}
      aria-label={label}
      data-dialog-close
      onClick={commands.closeDialog}
    >
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 6 12 12M6 18 18 6" />
      </svg>
    </button>
  );
}
