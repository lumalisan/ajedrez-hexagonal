import { useEffect, useMemo, useRef } from 'react';
import { describeAction } from '../engine';
import { analyzeMatchMoments } from '../match-insights';
import { replayRecord } from '../match-record';
import { useGame } from './game-context';

export function ReplayDock() {
  const { snapshot, commands } = useGame();
  const { matchRecord: record, replayCursor: cursor } = snapshot;
  const closeRef = useRef<HTMLButtonElement>(null);
  const moments = useMemo(() => (record ? analyzeMatchMoments(record) : []), [record]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  if (!record || cursor === null) return null;
  const description =
    cursor === 0
      ? 'Posición inicial'
      : describeAction(replayRecord(record, cursor - 1), record.actions[cursor - 1]);
  return (
    <section className="replay-dock" aria-label="Controles de repetición de partida">
      <div className="replay-heading">
        <div>
          <span className="eyebrow">REPETICIÓN</span>
          <strong>
            Posición <output data-replay-output>{cursor}</output> de {record.actions.length}
          </strong>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="icon-button replay-close"
          data-replay-close
          aria-label="Cerrar repetición"
          onClick={commands.closeReplay}
        >
          ×
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
          onChange={(event) => commands.setReplayCursor(Number(event.currentTarget.value))}
        />
        <button
          type="button"
          className="secondary-button"
          data-replay-step="1"
          aria-label="Posición siguiente"
          onClick={() => commands.setReplayCursor(cursor + 1)}
        >
          →
        </button>
      </div>
      {moments.length > 0 && (
        <section className="key-moments replay-moments" aria-label="Momentos destacados">
          <h3>Momentos destacados</h3>
          {moments.map((moment) => (
            <button
              key={moment.actionIndex}
              type="button"
              className="moment-jump"
              data-replay-moment={moment.actionIndex}
              onClick={() => commands.setReplayCursor(moment.actionIndex)}
            >
              <span>Orden {moment.actionIndex}</span>
              <strong>{moment.title}</strong>
              <small>
                {moment.suggestedAlternativeLabel
                  ? `Alternativa: ${moment.suggestedAlternativeLabel}`
                  : moment.detail}
              </small>
            </button>
          ))}
        </section>
      )}
      <div className="inline-actions">
        <button
          type="button"
          className="text-button replay-export"
          data-export-match
          onClick={commands.exportMatch}
        >
          Exportar partida
        </button>
      </div>
    </section>
  );
}
