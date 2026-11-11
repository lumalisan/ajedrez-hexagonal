import { useEffect, useState } from 'react';
import type { Player } from '../../types';
import { participantColor, participantName } from '../../factions';
import { OPENING_DRAW_MS } from '../../online-contracts';
import { useGame } from '../game-context';
import { Button } from '../components/ui/button';
import { OnlineAvailability } from './online-dialogs';

export function OpeningDrawDialog({ player }: { player: Player }) {
  const { snapshot, commands } = useGame();
  const reduced = snapshot.preferences.reducedMotion;
  const { online } = snapshot;
  const opening = online.state.status === 'playing' ? online.state.opening : undefined;
  const [animationFinished, setAnimationFinished] = useState(reduced);
  useEffect(() => {
    if (opening) return;
    const timer = setTimeout(() => setAnimationFinished(true), reduced ? 0 : OPENING_DRAW_MS);
    return () => clearTimeout(timer);
  }, [opening, reduced]);
  const ready = online.state.status === 'playing' && opening?.ready[online.state.player];
  const revealed = opening ? online.openingRevealed : animationFinished;
  const participant = snapshot.matchConfig?.participants[player];
  return (
    <section className="opening-draw" aria-label="Sorteo del primer turno">
      <h2>Sorteo del primer turno</h2>
      <div
        className="opening-coin"
        data-revealed={revealed}
        style={{ color: revealed ? participantColor(participant, player) : 'var(--text)' }}
        aria-hidden="true"
      >
        ⬡
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">
        {revealed ? (
          <>
            <p>Juega el primer turno</p>
            <strong>{participantName(participant)}</strong>
          </>
        ) : (
          <p>Sorteando…</p>
        )}
      </div>
      {opening && revealed && (
        <>
          <p className="text-sm text-muted">
            {ready
              ? 'Esperando al rival.'
              : 'La partida empieza cuando ambos confirméis o se agote el tiempo.'}
          </p>
          <p role="timer" aria-live="off" className="text-sm tabular-nums">
            Tiempo restante · {online.secondsRemaining} s
          </p>
        </>
      )}
      {opening && <OnlineAvailability />}
      <Button
        variant="primary"
        disabled={!revealed || ready || (opening != null && online.secondsRemaining === 0)}
        loading={opening != null && online.busy}
        onClick={commands.finishOpeningDraw}
      >
        Comenzar partida
      </Button>
    </section>
  );
}
