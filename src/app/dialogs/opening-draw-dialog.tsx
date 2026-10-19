import { useEffect, useState } from 'react';
import type { Player } from '../../types';
import { participantColor, participantLabel } from '../../factions';
import { PLAYER_NAMES } from '../../engine';
import { useGame } from '../game-context';
import { Button } from '../components/ui/button';

export function OpeningDrawDialog({ player }: { player: Player }) {
  const { snapshot, commands } = useGame();
  const reduced = snapshot.preferences.reducedMotion;
  const [revealed, setRevealed] = useState(reduced);
  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), reduced ? 0 : 1600);
    return () => clearTimeout(timer);
  }, [reduced]);
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
            <p>Empieza la partida</p>
            <strong>{participantLabel(participant, PLAYER_NAMES[player])}</strong>
          </>
        ) : (
          <p>Sorteando…</p>
        )}
      </div>
      <Button variant="primary" disabled={!revealed} onClick={commands.finishOpeningDraw}>
        Comenzar partida
      </Button>
    </section>
  );
}
