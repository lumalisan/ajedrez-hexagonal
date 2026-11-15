import { useEffect, useMemo, useRef, useState } from 'react';
import { outcomeText } from '../../engine';
import { replayRecord } from '../../match-record';
import { BoardRenderer, pieceAccessibleLabel } from '../../renderer';
import type { MatchRecord, Player } from '../../types';
import { RendererStatus } from '../components/renderer-status';
import { Button } from '../components/ui/button';

export function AdminReplayBoard({ record }: { record: MatchRecord }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<BoardRenderer | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = record.currentAction;
  const state = useMemo(() => replayRecord(record, cursor), [record, cursor]);
  useEffect(() => {
    const board = new BoardRenderer(canvas.current!);
    renderer.current = board;
    board.snapToPlayer(0);
    board.setFrame(record.config.board.cells, 24);
    return () => {
      renderer.current = null;
      board.destroy();
    };
  }, [record]);
  useEffect(() => {
    function maximumHp(owner: Player) {
      const fortress = record.config.setup.find(
        ({ piece }) => piece.owner === owner && piece.type === 'fortress',
      )?.piece;
      return fortress?.type === 'fortress' ? fortress.hp : 2;
    }
    renderer.current?.setModel({
      state,
      fortressMaxHp: [maximumHp(0), maximumHp(1)],
      selectedId: null,
      actions: [],
      pending: null,
      hovered: null,
      focused: null,
      firingRange: [],
      lastEvents: [],
      threatenedCells: [],
      reducedMotion: true,
      highContrast: false,
    });
  }, [state, record]);
  useEffect(() => {
    if (!playing || cursor >= last) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState === 'visible') {
        setCursor(cursor + 1);
        if (cursor + 1 === last) setPlaying(false);
      } else setPlaying(false);
    }, 750);
    return () => window.clearTimeout(timer);
  }, [cursor, last, playing]);
  function seek(next: number) {
    setPlaying(false);
    setCursor(next);
  }
  return (
    <>
      <div className="admin-replay-canvas">
        <canvas ref={canvas} aria-hidden="true" />
        <RendererStatus canvasRef={canvas} overlay />
      </div>
      <div className="admin-replay-controls">
        <div>
          <Button disabled={cursor === 0} onClick={() => seek(cursor - 1)}>
            Anterior
          </Button>
          <Button
            variant="primary"
            disabled={last === 0}
            onClick={() => {
              if (!playing && cursor === last) setCursor(0);
              setPlaying(!playing);
            }}
          >
            {playing ? 'Pausar' : 'Reproducir'}
          </Button>
          <Button disabled={cursor >= last} onClick={() => seek(cursor + 1)}>
            Siguiente
          </Button>
        </div>
        {last > 0 && (
          <input
            type="range"
            aria-label="Orden de la repetición"
            min={0}
            max={last}
            value={cursor}
            onChange={(event) => seek(Number(event.target.value))}
          />
        )}
        <p>
          Orden {cursor} de {last}
          {state.outcome
            ? ' · ' +
              outcomeText(
                state.outcome,
                state.outcome.type === 'win'
                  ? record.config.participants[state.outcome.winner].name
                  : undefined,
              )
            : ''}
        </p>
      </div>
      <details className="admin-board-text">
        <summary>Ver posición de las unidades</summary>
        <ul>
          {state.pieces.map((piece) => (
            <li key={piece.id}>{pieceAccessibleLabel(state, piece, 0)}</li>
          ))}
        </ul>
      </details>
    </>
  );
}
