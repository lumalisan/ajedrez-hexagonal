import { useGame } from '../game-context';

/** Informational dialogs do not pause a timed match. */
export function MatchClockNotice() {
  const { snapshot } = useGame();
  const running =
    snapshot.homeView === null &&
    !snapshot.state.outcome &&
    snapshot.replayCursor === null &&
    snapshot.matchRecord?.clock?.status === 'running';
  if (!running) return null;
  return (
    <p className="match-clock-notice" role="status">
      El reloj de la partida sigue en marcha mientras consultas esta ventana.
    </p>
  );
}
