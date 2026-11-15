import { useGame } from '../game-context';

/** The same close target and glyph for every dialog. */
export function DialogClose({
  label,
  className = '',
  onClose,
}: {
  label: string;
  className?: string;
  onClose?: () => void;
}) {
  const { commands } = useGame();
  return (
    <DialogCloseButton
      label={label}
      className={className}
      onClose={onClose ?? commands.closeDialog}
      autoFocus={onClose !== undefined}
    />
  );
}

export function DialogCloseButton({
  label,
  className = '',
  onClose,
  autoFocus,
}: {
  label: string;
  className?: string;
  onClose: () => void;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button achievement-close ${className}`}
      aria-label={label}
      autoFocus={autoFocus}
      data-dialog-close
      onClick={onClose}
    >
      <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 6 12 12M6 18 18 6" />
      </svg>
    </button>
  );
}
