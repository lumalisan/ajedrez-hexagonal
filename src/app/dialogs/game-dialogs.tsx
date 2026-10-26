import { ModeIcon } from '../components/mode-icon';
import { Button } from '../components/ui/button';
import { useState } from 'react';
import { loadActiveMatch } from '../../match-storage';
import { useGame } from '../game-context';
import { ConfigDialog, PrivateJoinDialog } from './game-config';
import { RulesDialog } from './game-rules';
import { OnlineMenuDialog, OnlineSearchDialog } from './online-dialogs';
import { useAccount } from '../account-context';
import { OnlineAccountNotice } from '../components/account-access';

export function GameDialogs() {
  const { snapshot } = useGame();
  switch (snapshot.dialog?.kind) {
    case 'online':
      return <OnlineMenuDialog />;
    case 'private-join':
      return <PrivateJoinDialog />;
    case 'online-search':
      return <OnlineSearchDialog />;
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
  const { account } = useAccount();
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
          data-game-mode="machine"
          onClick={() => commands.openDialog({ kind: 'config', mode: 'machine' })}
        >
          <strong className="game-mode-label">
            <span className="game-mode-icon">
              <ModeIcon mode="machine" />
            </span>
            Individual Vs. Hexfortia
          </strong>
          <small>Elige entre Fácil, Medio, Difícil, Experto y Neuronal.</small>
        </button>
        <button
          type="button"
          className="mode-card"
          data-game-mode="local"
          onClick={() => commands.openDialog({ kind: 'config', mode: 'local' })}
        >
          <strong className="game-mode-label">
            <span className="game-mode-icon">
              <ModeIcon mode="local" />
            </span>
            Batalla local
          </strong>
          <small>Dos jugadores comparten este dispositivo y alternan turnos.</small>
        </button>
        <button
          type="button"
          className="mode-card"
          data-game-mode="online"
          onClick={() => commands.openDialog({ kind: 'online' })}
        >
          <strong className="game-mode-label">
            <span className="game-mode-icon">
              <ModeIcon mode="online" />
            </span>
            Batalla en línea
          </strong>
          {account.user ? (
            <small>Busca un rival o crea una partida privada.</small>
          ) : (
            <OnlineAccountNotice />
          )}
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
