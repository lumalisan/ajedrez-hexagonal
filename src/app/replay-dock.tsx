import { useEffect, useRef } from 'react';
import type { FloatingPanel } from '../floating-panel';
import { FloatingPanelWindow } from './components/floating-panel-window';
import { useGame } from './game-context';

export function ReplayDock() {
  const { snapshot, commands } = useGame();
  const { matchRecord: record, replayCursor: cursor, state } = snapshot;
  const panelRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<FloatingPanel | null>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLButtonElement>('[data-replay-close]')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  if (!record || cursor === null) return null;
  const description =
    cursor === 0
      ? 'Posición inicial'
      : (state.history.find((entry) => entry.id === state.ply)?.text ?? 'Orden completada.');
  return (
    <FloatingPanelWindow
      kind="replay"
      visible
      panelRef={panelRef}
      controllerRef={floatingRef}
      onClose={commands.closeReplay}
    >
      <div className="replay-content">
        <div className="replay-heading">
          <strong>
            Posición <output data-replay-output>{cursor}</output> de {record.actions.length}
          </strong>
          <button
            type="button"
            className="text-button replay-export"
            data-export-match
            onClick={commands.exportMatch}
          >
            Exportar partida
          </button>
        </div>
        <p className="replay-description" data-replay-description>
          {description}
        </p>
        <div className="replay-controls">
          <button
            type="button"
            className="secondary-button"
            data-replay-step="-1"
            aria-label="Posición anterior"
            disabled={cursor === 0}
            onClick={() => commands.setReplayCursor(cursor - 1)}
          >
            ←
          </button>
          <input
            type="range"
            min={0}
            max={record.actions.length}
            value={cursor}
            data-replay-slider
            aria-label="Posición de la repetición"
            aria-valuetext={`Posición ${cursor} de ${record.actions.length}. ${description}`}
            onChange={(event) => commands.setReplayCursor(Number(event.currentTarget.value))}
          />
          <button
            type="button"
            className="secondary-button"
            data-replay-step="1"
            aria-label="Posición siguiente"
            disabled={cursor === record.actions.length}
            onClick={() => commands.setReplayCursor(cursor + 1)}
          >
            →
          </button>
        </div>
      </div>
    </FloatingPanelWindow>
  );
}
