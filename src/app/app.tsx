import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GameContext, useGame } from './game-context';
import { createGameSession } from './game-session';
import { GameShell } from './game-shell';
import { GameDialogs } from './dialogs/game-dialogs';
import { UtilityDialogs } from './dialogs/utility-dialogs';

export function App() {
  const [session] = useState(createGameSession);
  useEffect(() => session.start(), [session]);
  return (
    <GameContext.Provider value={session}>
      <ApplicationEffects />
      <GameShell />
      <DialogHost />
      <Toasts />
    </GameContext.Provider>
  );
}

function ApplicationEffects() {
  const { snapshot, commands, session } = useGame();
  const { preferences, state, homeView, matchConfig, replayCursor } = snapshot;
  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', preferences.highContrast);
    document.documentElement.classList.toggle('reduced-motion', preferences.reducedMotion);
    return () => document.documentElement.classList.remove('high-contrast', 'reduced-motion');
  }, [preferences.highContrast, preferences.reducedMotion]);
  const critical =
    homeView === null &&
    !state.outcome &&
    state.pieces.some((piece) => {
      if (piece.type !== 'fortress' || piece.hp !== 1) return false;
      const configured = matchConfig?.setup.find(
        (entry) => entry.piece.type === 'fortress' && entry.piece.owner === piece.owner,
      )?.piece;
      return (configured?.type === 'fortress' ? configured.hp : 2) > 1;
    });
  useEffect(() => {
    document.body.classList.toggle('fortress-critical', critical);
    document.body.classList.toggle('replay-active', replayCursor !== null);
    return () => document.body.classList.remove('fortress-critical', 'replay-active');
  }, [critical, replayCursor]);
  const hasOutcome = homeView === null && Boolean(state.outcome);
  useEffect(() => {
    if (!hasOutcome || preferences.reducedMotion) return;
    document.body.classList.add('match-climax');
    const timer = setTimeout(() => document.body.classList.remove('match-climax'), 1_400);
    return () => {
      clearTimeout(timer);
      document.body.classList.remove('match-climax');
    };
  }, [hasOutcome, preferences.reducedMotion]);
  useEffect(() => {
    const events = new AbortController();
    window.addEventListener(
      'keydown',
      (event) => {
        const current = session.getSnapshot();
        if (event.key !== 'Escape' || event.defaultPrevented || current.dialog) return;
        if (current.pendingAction || current.mode.kind !== 'default') commands.cancelDraft();
        else if (current.selectedId) commands.clearSelection();
      },
      { signal: events.signal },
    );
    return () => events.abort();
  }, [commands, session]);
  return null;
}

function DialogHost() {
  const { snapshot, commands, session } = useGame();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const focusReturn = useRef<HTMLElement | null>(null);
  const dialog = snapshot.dialog;
  const isOpen = dialog !== null;

  useLayoutEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (isOpen) {
      focusReturn.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.documentElement.classList.add('modal-open');
      if (!element.open) element.showModal();
    } else {
      if (element.open) element.close();
      document.documentElement.classList.remove('modal-open');
      const target = focusReturn.current;
      const frame = requestAnimationFrame(() => {
        if (session.getSnapshot().dialog || session.getSnapshot().replayCursor !== null) return;
        if (target?.isConnected && target.getClientRects().length && !target.closest('[inert]'))
          target.focus({ preventScroll: true });
        else if (session.getSnapshot().homeView === null)
          document.getElementById('game-canvas')?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
    return () => {
      document.documentElement.classList.remove('modal-open');
    };
  }, [isOpen, session]);

  useLayoutEffect(() => {
    if (!dialog) return;
    const heading = dialogRef.current?.querySelector('h2');
    if (heading) {
      heading.id = 'active-dialog-title';
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [dialog]);

  useEffect(() => {
    if (!isOpen) return;
    const events = new AbortController();
    const preventBackgroundScroll = (event: Event): void => {
      if (event.target instanceof Node && !dialogRef.current?.contains(event.target))
        event.preventDefault();
    };
    const options = { capture: true, passive: false, signal: events.signal };
    document.addEventListener('wheel', preventBackgroundScroll, options);
    document.addEventListener('touchmove', preventBackgroundScroll, options);
    return () => events.abort();
  }, [isOpen]);

  useEffect(() => {
    if (snapshot.dialogError)
      dialogRef.current?.querySelector<HTMLElement>('[data-dialog-error]')?.focus();
  }, [snapshot.dialogError]);

  return (
    <>
      <dialog
        ref={dialogRef}
        id="game-dialog"
        className="game-dialog"
        aria-labelledby={isOpen ? 'active-dialog-title' : undefined}
        data-mandatory={dialog?.kind === 'handoff' ? 'true' : undefined}
        onClick={(event) => {
          if (event.target === event.currentTarget && dialog?.kind !== 'handoff')
            commands.closeDialog();
        }}
        onCancel={(event) => {
          event.preventDefault();
          if (dialog?.kind !== 'handoff') commands.closeDialog();
        }}
        onClose={() => {
          if (!dialogRef.current?.open && session.getSnapshot().dialog) commands.closeDialog();
        }}
      >
        {dialog && (
          <div className="dialog-body" key={dialog.kind}>
            <GameDialogs />
            <UtilityDialogs />
            {snapshot.dialogError && (
              <p className="dialog-error" role="alert" tabIndex={-1} data-dialog-error>
                {snapshot.dialogError}
              </p>
            )}
          </div>
        )}
        {isOpen && <FullscreenControl />}
      </dialog>
      {!isOpen && <FullscreenControl />}
    </>
  );
}

function FullscreenControl() {
  const { commands } = useGame();
  const control = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  useEffect(() => {
    const update = (): void => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', update);
    const element = control.current;
    if (element && typeof element.showPopover === 'function') element.showPopover();
    return () => {
      document.removeEventListener('fullscreenchange', update);
    };
  }, []);
  const toggle = async (): Promise<void> => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      else {
        commands.announce('Este navegador no permite activar la pantalla completa.');
        commands.showToast('Este navegador no permite activar la pantalla completa.');
      }
    } catch {
      commands.announce('No se pudo cambiar la pantalla completa. Vuelve a intentarlo.');
      commands.showToast('No se pudo cambiar la pantalla completa. Vuelve a intentarlo.');
    }
  };
  const label = fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa';
  return (
    <div ref={control} id="fullscreen-control" className="fullscreen-control" popover="manual">
      <button
        type="button"
        id="fullscreen-button"
        className="icon-button"
        aria-label={label}
        aria-pressed={fullscreen}
        title={label}
        onClick={() => void toggle()}
      >
        <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />
        </svg>
      </button>
    </div>
  );
}

function Toasts() {
  const { snapshot } = useGame();
  return (
    <div id="toast-region" className="toast-region" aria-live="polite">
      {snapshot.toasts.map((toast) => (
        <Toast key={toast.id} message={toast.message} />
      ))}
    </div>
  );
}

function Toast({ message }: { message: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 10);
    const hide = setTimeout(() => setVisible(false), 2_600);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, []);
  return <div className={`toast${visible ? ' visible' : ''}`}>{message}</div>;
}
