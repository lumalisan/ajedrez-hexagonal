import { BoardCanvas } from './board-canvas';
import { useGame } from './game-context';
import { HomeScreen } from './home-screen';
import {
  BattleLog,
  CommandPanel,
  MatchStatus,
  ScreenReaderBoard,
  SelectionSummary,
} from './panels';
import { ReplayDock } from './replay-dock';
import { SettingsIcon, SoundButton, WarningIcon } from './shell-icons';
import { AchievementsMenuIcon } from './components/achievement-icon';
import { TutorialPanel } from './tutorial-panel';

function Header() {
  const { snapshot, commands } = useGame();
  const { state, activeScenario, machineThinking, animating, replayCursor, gameMode, matchRecord } =
    snapshot;
  const disabled =
    Boolean(state.outcome) ||
    animating ||
    machineThinking ||
    replayCursor !== null ||
    Boolean(activeScenario) ||
    Boolean(snapshot.tutorial);
  return (
    <header className="topbar" inert={snapshot.homeView !== null}>
      <div
        className="brand"
        role="img"
        aria-label="Protocolo Hexagonal: Estrategia Hexagonal - Protocolo Hexagonal"
      >
        <img src="/atlas-mark.svg" alt="" width="38" height="38" />
        <div>
          <span className="eyebrow">ESTRATEGIA HEXAGONAL</span>
          <strong>Protocolo Hexagonal</strong>
        </div>
      </div>
      <MatchStatus />
      <div className="top-actions">
        <SoundButton />
        <button
          className="icon-button"
          id="settings-button"
          type="button"
          aria-label="Abrir opciones"
          title="Opciones"
          onClick={() => commands.openDialog({ kind: 'settings' })}
        >
          <SettingsIcon />
        </button>
        <button
          className="icon-button"
          id="help-button"
          type="button"
          aria-label="Abrir reglas"
          title="Reglas"
          onClick={() => commands.openDialog({ kind: 'rules' })}
        >
          <span aria-hidden="true">?</span>
        </button>
        <button
          className="icon-button"
          id="achievements-button"
          type="button"
          aria-label="Abrir logros"
          title="Logros"
          onClick={() => commands.openDialog({ kind: 'achievements' })}
        >
          <AchievementsMenuIcon />
        </button>
        <button
          className="icon-button"
          id="resign-button"
          type="button"
          aria-label="Rendirse"
          title="Rendirse"
          disabled={!matchRecord || disabled}
          onClick={() => commands.openDialog({ kind: 'resign' })}
        >
          <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 21V4m0 1c4-4 8 4 14 0v10c-6 4-10-4-14 0" />
          </svg>
        </button>
        <button
          className="icon-button"
          id="blockade-button"
          type="button"
          aria-label="Proponer tablas"
          title="Proponer tablas"
          disabled={disabled || gameMode === 'machine'}
          hidden={gameMode === 'machine' || Boolean(activeScenario) || Boolean(snapshot.tutorial)}
          onClick={() => commands.openDialog({ kind: 'draw-offer' })}
        >
          <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m2 10 4-5 4 2m12 3-4-5-4 1-5 5 2 2 4-3 5 5-6 5-8-6-4-4Zm4 4 4-5m10 6 2-5M9 17l2-2m1 4 2-2" />
          </svg>
        </button>
        <button
          className="menu-button"
          id="new-game-button"
          type="button"
          onClick={() =>
            snapshot.tutorial ? commands.exitTutorial() : commands.openDialog({ kind: 'abandon' })
          }
        >
          {snapshot.tutorial ? 'Salir del tutorial' : 'Abandonar partida'}
        </button>
      </div>
    </header>
  );
}

function BoardToolbar() {
  const { snapshot, commands } = useGame();
  const {
    logOpen,
    isLocalMatch,
    replayCursor,
    homeView,
    animating,
    machineThinking,
    matchRecord,
    canUndo,
    canRedo,
  } = snapshot;
  const historyVisible =
    isLocalMatch && replayCursor === null && homeView === null && snapshot.tutorial === null;
  const toggleLog = () => {
    commands.setLogOpen(!logOpen);
  };
  return (
    <div className="board-toolbar">
      <SelectionSummary />
      <div className="zoom-controls" aria-label="Controles del tablero">
        <div
          id="history-controls"
          className="history-controls"
          role="group"
          aria-label="Historial de órdenes"
          hidden={!historyVisible}
        >
          <button
            type="button"
            id="undo-action"
            aria-label="Deshacer última orden"
            title="Deshacer última orden"
            disabled={!historyVisible || animating || !canUndo}
            onClick={commands.undo}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12" transform="translate(0 -2)" />
            </svg>
          </button>
          <button
            type="button"
            id="redo-action"
            aria-label="Rehacer última orden"
            title="Rehacer última orden"
            disabled={!historyVisible || animating || !canRedo}
            onClick={commands.redo}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12" transform="translate(0 -2)" />
            </svg>
          </button>
        </div>
        <button
          type="button"
          id="replay-button"
          data-open-replay
          hidden={Boolean(snapshot.tutorial)}
          aria-label={replayCursor === null ? 'Ver repetición' : 'Cerrar repetición'}
          title={replayCursor === null ? 'Ver repetición' : 'Cerrar repetición'}
          aria-expanded={replayCursor !== null}
          disabled={!matchRecord || animating || machineThinking}
          onClick={() => {
            if (replayCursor === null) commands.openReplay();
            else commands.closeReplay();
          }}
        >
          <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="6" width="12" height="12" rx="2" />
            <path d="m15 10 6-3v10l-6-3Z" />
          </svg>
        </button>
        <button
          type="button"
          id="log-toggle"
          hidden={Boolean(snapshot.tutorial)}
          aria-label={logOpen ? 'Ocultar registro de batalla' : 'Mostrar registro de batalla'}
          aria-controls="battle-log-panel"
          aria-expanded={logOpen}
          aria-pressed={logOpen}
          title={logOpen ? 'Ocultar registro de batalla' : 'Registro de batalla'}
          onClick={toggleLog}
        >
          <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3h14v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 0v18M10 7h6m-6 5h6m-6 5h4" />
          </svg>
        </button>
        <div className="view-controls" role="group" aria-label="Vista del tablero">
          <button
            type="button"
            id="zoom-out"
            aria-label="Alejar"
            onClick={() => commands.zoomBy(1 / 1.16)}
          >
            −
          </button>
          <button
            type="button"
            id="reset-view"
            aria-label="Centrar tablero"
            onClick={commands.resetView}
          >
            ◎
          </button>
          <button
            type="button"
            id="zoom-in"
            aria-label="Acercar"
            onClick={() => commands.zoomBy(1.16)}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

function BoardLegend() {
  return (
    <div className="legend" aria-label="Leyenda del tablero">
      <span>
        <i className="legend-dot move" />
        Movimiento
      </span>
      <span>
        <i className="legend-dot attack" />
        Ataque
      </span>
      <span>
        <i className="legend-dot range" />
        Alcance
      </span>
      <span>
        <svg className="legend-net" viewBox="-12 -12 24 24" aria-hidden="true" focusable="false">
          <path d="M0 0 0-10M0 0 7-7M0 0 10 0M0 0 7 7M0 0 0 10M0 0-7 7M0 0-10 0M0 0-7-7" />
          <path d="M0-3Q1.4-2.5 2.2-2.2Q2.5-1.4 3 0Q2.5 1.4 2.2 2.2Q1.4 2.5 0 3Q-1.4 2.5-2.2 2.2Q-2.5 1.4-3 0Q-2.5-1.4-2.2-2.2Q-1.4-2.5 0-3ZM0-6Q2.8-5 4.4-4.4Q5-2.8 6 0Q5 2.8 4.4 4.4Q2.8 5 0 6Q-2.8 5-4.4 4.4Q-5 2.8-6 0Q-5-2.8-4.4-4.4Q-2.8-5 0-6ZM0-10Q4.6-8.2 7-7Q8.2-4.6 10 0Q8.2 4.6 7 7Q4.6 8.2 0 10Q-4.6 8.2-7 7Q-8.2 4.6-10 0Q-8.2-4.6-7-7Q-4.6-8.2 0-10Z" />
        </svg>
        Conversión
      </span>
      <span>
        <WarningIcon className="legend-danger" />
        Intercepción
      </span>
    </div>
  );
}

export function GameShell() {
  const { snapshot } = useGame();
  const { homeView, replayCursor } = snapshot;
  return (
    <div
      id="app"
      className={`app-shell${homeView !== null ? ' home-active' : ''}${snapshot.tutorial ? ' tutorial-active' : ''}`}
    >
      <HomeScreen />
      <Header />
      <main className="game-layout" inert={homeView !== null}>
        <section className="board-stage" aria-label="Tablero de juego">
          <BoardToolbar />
          <div className="board-arena" id="board-arena">
            <TutorialPanel />
            <BoardCanvas />
            <CommandPanel />
            <BattleLog />
          </div>
          <BoardLegend />
          {replayCursor !== null && <ReplayDock />}
        </section>
        <ScreenReaderBoard />
      </main>
      <div id="announcer" className="sr-only" aria-live="assertive">
        <span key={snapshot.announcementId}>{snapshot.announcement}</span>
      </div>
    </div>
  );
}
