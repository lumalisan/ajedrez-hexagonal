import {
  useLayoutEffect,
  useRef,
  type FocusEventHandler,
  type ReactNode,
  type RefObject,
} from 'react';
import { FloatingPanel } from '../../floating-panel';

const WINDOWS = {
  command: {
    label: 'Panel de mando',
    panel: 'command-panel',
    titlebar: 'command-window-titlebar',
    minimize: 'minimize-command-panel',
    close: 'close-command-panel',
    restore: 'command-panel-restore',
    side: 'right',
  },
  'battle-log': {
    label: 'Registro de batalla',
    panel: 'battle-log-panel',
    titlebar: 'battle-log-window-titlebar',
    minimize: 'minimize-battle-log',
    close: 'close-battle-log',
    restore: 'battle-log-restore',
    side: 'left',
  },
} as const;

interface FloatingPanelWindowProps {
  kind: keyof typeof WINDOWS;
  visible: boolean;
  panelRef: RefObject<HTMLElement | null>;
  controllerRef: RefObject<FloatingPanel | null>;
  onClose(): void;
  onFocusCapture?: FocusEventHandler<HTMLElement>;
  onBlurCapture?: FocusEventHandler<HTMLElement>;
  children: ReactNode;
}

export function FloatingPanelWindow({
  kind,
  visible,
  panelRef,
  controllerRef,
  onClose,
  onFocusCapture,
  onBlurCapture,
  children,
}: FloatingPanelWindowProps) {
  const titleRef = useRef<HTMLDivElement>(null);
  const minimizeRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);
  const config = WINDOWS[kind];
  useLayoutEffect(() => {
    const arena = panelRef.current?.parentElement;
    if (
      !arena ||
      !panelRef.current ||
      !titleRef.current ||
      !minimizeRef.current ||
      !closeRef.current ||
      !restoreRef.current
    )
      return;
    const floating = new FloatingPanel(
      {
        arena,
        panel: panelRef.current,
        titlebar: titleRef.current,
        minimize: minimizeRef.current,
        close: closeRef.current,
        restore: restoreRef.current,
      },
      onClose,
      config.side,
    );
    controllerRef.current = floating;
    return () => {
      floating.destroy();
      controllerRef.current = null;
    };
  }, [config.side, controllerRef, onClose, panelRef]);
  useLayoutEffect(() => {
    controllerRef.current?.setVisible(visible);
  }, [controllerRef, visible]);

  return (
    <>
      <aside
        ref={panelRef}
        className={`${config.panel} floating-panel`}
        id={config.panel}
        aria-label={config.label}
        hidden
        onPointerDownCapture={() => controllerRef.current?.bringToFront()}
        onFocusCapture={(event) => {
          controllerRef.current?.bringToFront();
          onFocusCapture?.(event);
        }}
        onBlurCapture={onBlurCapture}
      >
        <div
          ref={titleRef}
          className="command-window-titlebar"
          id={config.titlebar}
          role="group"
          tabIndex={0}
          aria-label={`${config.label}. Arrastra para mover o usa las teclas de flecha.`}
        >
          <span className="command-window-title">{config.label}</span>
          <div className="command-window-controls" role="group" aria-label="Controles del panel">
            <button
              ref={minimizeRef}
              type="button"
              id={config.minimize}
              data-window-minimize
              aria-label={`Minimizar ${config.label.toLowerCase()}`}
              title={`Minimizar ${config.label.toLowerCase()}`}
              onClick={() => controllerRef.current?.minimize()}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M3 8h10" />
              </svg>
            </button>
            <button
              ref={closeRef}
              type="button"
              id={config.close}
              data-window-close
              aria-label={`Cerrar ${config.label.toLowerCase()}`}
              title={`Cerrar ${config.label.toLowerCase()}`}
              onClick={() => controllerRef.current?.close()}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 4 8 8m0-8-8 8" />
              </svg>
            </button>
          </div>
        </div>
        {children}
      </aside>
      <button
        ref={restoreRef}
        type="button"
        className={`command-panel-restore ${kind}-restore`}
        id={config.restore}
        aria-label={`Restaurar ${config.label.toLowerCase()}`}
        title={`Restaurar ${config.label.toLowerCase()}`}
        hidden
        onClick={() => controllerRef.current?.restore()}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3 5h14v11H3Zm0 3h14M5 3h14v11" />
        </svg>
        <span>{config.label}</span>
        <span className="command-restore-label">Restaurar</span>
      </button>
    </>
  );
}
