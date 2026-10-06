import { Button } from '../components/ui/button';
import { useState } from 'react';
import { loadActiveMatch } from '../../match-storage';
import { useGame } from '../game-context';
import { ConfigDialog } from './game-config';
import { RulesDialog } from './game-rules';

export function GameDialogs() {
  const { snapshot } = useGame();
  switch (snapshot.dialog?.kind) {
    case 'config':
      return <ConfigDialog key={snapshot.dialog.mode} mode={snapshot.dialog.mode} />;
    case 'mode':
      return <ModeDialog initial={snapshot.dialog.initial ?? false} />;
    case 'rules':
      return <RulesDialog key={snapshot.dialog.sectionId} sectionId={snapshot.dialog.sectionId} />;
    default:
      return null;
  }
}

function ModeDialog({ initial }: { initial: boolean }) {
  const { commands } = useGame();
  const [saved] = useState(loadActiveMatch);

  return (
    <>
      <div className="dialog-icon">♟</div>
      <span className="eyebrow">{initial ? 'CENTRO DE MANDO' : 'NUEVA PARTIDA'}</span>
      <h2>Elige tu próxima misión</h2>
      <p>
        {saved.error
          ? `El guardado anterior se descartó: ${saved.error}`
          : 'Juega una partida local o contra la inteligencia artificial.'}
      </p>
      {saved.record && (
        <button
          type="button"
          className="continue-card"
          data-continue-match
          onClick={() => {
            if (saved.record) commands.loadRecord(saved.record);
          }}
        >
          <strong>Continuar partida</strong>
          <small>
            {saved.record.currentAction} órdenes guardadas ·{' '}
            {saved.record.config.participants[0].name} vs {saved.record.config.participants[1].name}
          </small>
        </button>
      )}
      <div className="mode-choice" role="group" aria-label="Modo de juego">
        <button
          type="button"
          className="mode-card"
          data-game-mode="local"
          onClick={() => commands.openDialog({ kind: 'config', mode: 'local' })}
        >
          <span className="mode-icon" aria-hidden="true">
            ♙ ♟
          </span>
          <strong>Partida libre local</strong>
          <small>Dos jugadores comparten este dispositivo y alternan turnos.</small>
        </button>
        <button
          type="button"
          className="mode-card featured"
          data-game-mode="machine"
          onClick={() => commands.openDialog({ kind: 'config', mode: 'machine' })}
        >
          <span className="mode-icon" aria-hidden="true">
            ♙ ⬡
          </span>
          <strong>Partida libre vs IA</strong>
          <small>Elige entre Fácil, Medio, Difícil y Experto.</small>
        </button>
      </div>
      {!initial && (
        <div className="dialog-actions">
          <Button
            type="button"
            variant="secondary"
            data-dialog-close
            onClick={commands.closeDialog}
          >
            Cancelar
          </Button>
        </div>
      )}
    </>
  );
}
