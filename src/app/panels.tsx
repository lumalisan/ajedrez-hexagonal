import { useCallback, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { sameAction } from '../action-identity';
import {
  PIECE_NAMES,
  PLAYER_NAMES,
  actionDestination,
  describeAction,
  getLegalActionsForPiece,
  getPiece,
  isAirPiece,
  occupancyAt,
  outcomeText,
} from '../engine';
import type { FloatingPanel } from '../floating-panel';
import { ALL_DIRECTIONS, DIRECTION_NAMES, equalHex, hexKey, isOnBoard } from '../hex';
import { TURN_TIMEOUT_LIMIT } from '../match-clock';
import { actionsAtHex, pieceAccessibleLabel } from '../rendering/model';
import { scenarioLessonAt } from '../scenarios';
import { getTutorialActions, TUTORIAL_STEPS } from '../tutorial';
import type { Direction, GameAction, Piece, Player } from '../types';
import { captureAboveCommandLabel, selectedUnitInstruction } from '../ui-copy';
import { useGame } from './game-context';
import { accessibleCellId, fortressMaximumHp } from './shell-selectors';
import { FloatingPanelWindow } from './components/floating-panel-window';
import { WarningIcon } from './shell-icons';

function useTutorialControls() {
  const { snapshot } = useGame();
  const step = snapshot.tutorial ? TUTORIAL_STEPS[snapshot.tutorial.stepIndex] : undefined;
  const restricted = Boolean(step && step.interaction !== 'free');
  const actions =
    restricted && snapshot.tutorial
      ? getTutorialActions(snapshot.state, snapshot.tutorial.stepIndex)
      : [];
  return {
    step,
    restricted,
    guided: Boolean(step && step.guided !== false && step.interaction !== 'free'),
    actionAllowed: (action: GameAction) =>
      !restricted || actions.some((candidate) => sameAction(candidate, action)),
    modeAllowed: (kind: 'rotate' | 'orient' | 'transform') => !restricted || step?.mode === kind,
  };
}

function formatClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function ClockTime({
  id,
  remainingMs,
  label,
  active,
}: {
  id: string;
  remainingMs: number;
  label: string;
  active: boolean;
}) {
  const time = formatClock(remainingMs);
  const urgency = remainingMs <= 20_000 ? 'critical' : remainingMs <= 60_000 ? 'warning' : '';
  return (
    <output
      id={id}
      className={`match-clock ${active ? 'active' : ''} ${urgency}`.trim()}
      role="timer"
      aria-live="off"
      aria-label={`${label}: ${time}`}
      title={label}
    >
      {time}
    </output>
  );
}

function FactionMark({ player }: { player: Player }) {
  return (
    <span className="faction-mark" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path className="faction-mark-frame" d="M16 2.75 27.5 9.4v13.2L16 29.25 4.5 22.6V9.4Z" />
        {player === 0 ? (
          <>
            <circle className="faction-mark-core" cx="16" cy="16" r="5.25" />
            <path className="faction-mark-detail" d="M16 5.5v5M16 21.5v5M5.5 16h5M21.5 16h5" />
            <circle className="faction-mark-node" cx="16" cy="16" r="1.8" />
          </>
        ) : (
          <>
            <path className="faction-mark-core" d="m16 8 8 8-8 8-8-8Z" />
            <path
              className="faction-mark-detail"
              d="m16 4 3.2 5.2M28 16l-5.2 3.2M16 28l-3.2-5.2M4 16l5.2-3.2"
            />
            <path className="faction-mark-node" d="m16 12 4 4-4 4-4-4Z" />
          </>
        )}
      </svg>
    </span>
  );
}

function FortressStatus({ player }: { player: Player }) {
  const { snapshot } = useGame();
  const fortress = snapshot.state.pieces.find(
    (piece) => piece.type === 'fortress' && piece.owner === player,
  );
  const hp = fortress?.type === 'fortress' ? fortress.hp : 0;
  const maximum = fortressMaximumHp(snapshot, player);
  const faction = player === 0 ? 'blue' : 'amber';
  const clock = snapshot.matchRecord?.clock;
  const turnTimeouts = clock?.turnTimeouts?.[player] ?? 0;
  return (
    <div className={`fortress-status player-${faction}`} id={`${faction}-fortress`}>
      <div className="faction-identity">
        <FactionMark player={player} />
        <strong>{PLAYER_NAMES[player]}</strong>
      </div>
      <div className="faction-vitals">
        <span
          className="hp"
          role="img"
          aria-label={`Fortaleza de ${PLAYER_NAMES[player]}: ${hp} de ${maximum} puntos de vida`}
        >
          {Array.from({ length: maximum }, (_, index) => (
            <i key={index} className={hp > index ? 'active' : ''} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 21s-8.5-5.2-8.5-12A4.5 4.5 0 0 1 12 6.9 4.5 4.5 0 0 1 20.5 9c0 6.8-8.5 12-8.5 12Z" />
              </svg>
            </i>
          ))}
        </span>
        {clock?.initialMs != null && (
          <ClockTime
            id={`${faction}-clock`}
            remainingMs={clock.remainingMs[player]}
            label={`Tiempo total de ${PLAYER_NAMES[player]}`}
            active={clock.activePlayer === player && clock.status === 'running'}
          />
        )}
        {turnTimeouts > 0 && (
          <small
            className="turn-timeouts"
            title={`Turnos agotados de ${PLAYER_NAMES[player]}. Al llegar a ${TURN_TIMEOUT_LIMIT}, pierdes la partida.`}
          >
            Agotados {turnTimeouts}/{TURN_TIMEOUT_LIMIT}
          </small>
        )}
      </div>
    </div>
  );
}

export function MatchStatus() {
  const { snapshot } = useGame();
  const { state, activeScenario, scenarioProgress, machineThinking, machineSearch, isMachineTurn } =
    snapshot;
  const clock = snapshot.matchRecord?.clock;
  const commander =
    clock?.status === 'turn-expired'
      ? `IA juega por ${PLAYER_NAMES[state.activePlayer]}`
      : isMachineTurn
        ? machineThinking
          ? machineSearch
            ? `IA · profundidad ${machineSearch.completedDepth}/${machineSearch.requestedDepth}`
            : 'Máquina pensando…'
          : 'Máquina en mando'
        : `${PLAYER_NAMES[state.activePlayer]} en mando`;
  return (
    <div className="match-status" aria-live="polite">
      <FortressStatus player={0} />
      <div
        className={`turn-chip ${state.outcome ? 'finished' : state.activePlayer === 0 ? 'blue' : 'amber'}`}
        id="turn-chip"
      >
        {state.outcome ? (
          <>
            <span>PARTIDA FINALIZADA</span>
            <strong>{outcomeText(state.outcome)}</strong>
          </>
        ) : (
          <>
            <span>{snapshot.tutorial ? 'TUTORIAL' : `TURNO ${Math.floor(state.ply / 2) + 1}`}</span>
            <strong>{snapshot.tutorial ? 'Práctica con Cian' : commander}</strong>
            {activeScenario && (
              <small>
                {scenarioLessonAt(activeScenario, state.ply - activeScenario.initialState.ply)}
                {scenarioProgress?.remainingPlies != null &&
                  ` · quedan ${scenarioProgress.remainingPlies}`}
              </small>
            )}
          </>
        )}
        {clock?.turnRemainingMs != null && (
          <ClockTime
            id="turn-clock"
            remainingMs={clock.turnRemainingMs}
            label={`Turno de ${PLAYER_NAMES[clock.activePlayer]}`}
            active={clock.status === 'running'}
          />
        )}
      </div>
      <FortressStatus player={1} />
    </div>
  );
}

export function SelectionSummary() {
  const { snapshot } = useGame();
  const { state, pendingAction, mode, selectedId, isMachineTurn } = snapshot;
  const piece = selectedId ? getPiece(state, selectedId) : undefined;
  const text = state.outcome
    ? outcomeText(state.outcome)
    : pendingAction
      ? 'Confirma la acción en el panel de mando.'
      : mode.kind === 'rotate' || mode.kind === 'orient' || mode.kind === 'transform'
        ? 'Elige un rumbo en la brújula del panel de mando.'
        : mode.kind === 'pieceChoice'
          ? 'Casilla apilada. Elige una unidad en el panel de mando.'
          : mode.kind === 'actionChoice'
            ? 'Elige una acción en el panel de mando.'
            : piece
              ? piece.owner === state.activePlayer
                ? selectedUnitInstruction(piece)
                : `${PIECE_NAMES[piece.type]} de ${PLAYER_NAMES[piece.owner]}. Selecciona una unidad propia para jugar.`
              : isMachineTurn
                ? 'La máquina está calculando su siguiente orden.'
                : `Turno de ${PLAYER_NAMES[state.activePlayer]}. Selecciona una unidad propia.`;
  return (
    <div id="selection-summary" className="selection-summary">
      {snapshot.tutorial ? TUTORIAL_STEPS[snapshot.tutorial.stepIndex]?.instruction : text}
    </div>
  );
}

function directionName(direction: Direction, player: Player): string {
  return DIRECTION_NAMES[((direction + (player === 0 ? 3 : 0)) % 6) as Direction];
}

function pieceMonogram(piece: Piece): string {
  return {
    soldier: 'S',
    capturer: 'C',
    medium: 'T',
    long: 'LM',
    fast: 'E',
    drone: 'D',
    airplane: 'A',
    antiAir: 'EA',
    fortress: 'F',
  }[piece.type];
}

function PieceCard({ piece }: { piece?: Piece }) {
  const { snapshot } = useGame();
  if (!piece) return null;
  let detail: ReactNode;
  if (piece.type === 'soldier' || piece.type === 'airplane')
    detail = (
      <span>
        Orientación <strong>{directionName(piece.facing, snapshot.viewPlayer)}</strong>
      </span>
    );
  else if (piece.type === 'medium')
    detail = (
      <span>
        Cañón <strong>{directionName(piece.cannon, snapshot.viewPlayer)}</strong>
      </span>
    );
  else if (piece.type === 'fortress')
    detail = (
      <span>
        Integridad{' '}
        <strong>
          {piece.hp}/{fortressMaximumHp(snapshot, piece.owner)} HP
        </strong>
      </span>
    );
  const signed = (number: number) => (number >= 0 ? `+${number}` : `${number}`);
  return (
    <div id="piece-card" className={`piece-card player-${piece.owner === 0 ? 'blue' : 'amber'}`}>
      <div className="piece-title-row">
        <div className="piece-monogram" aria-hidden="true">
          {pieceMonogram(piece)}
        </div>
        <h2>{PIECE_NAMES[piece.type]}</h2>
      </div>
      <div className="piece-stats">
        <span>
          Coordenadas{' '}
          <strong>
            {signed(piece.position.q)}, {signed(piece.position.r)}
          </strong>
        </span>
        {detail}
        {piece.type === 'long' && (
          <span>
            Misiles <strong>{piece.missilesRemaining ?? 2}/2</strong>
          </span>
        )}
      </div>
    </div>
  );
}

interface CompassProps {
  current: Direction | null;
  selected: Direction | null;
  dataName: 'direction-order' | 'transform-facing' | 'pending-cannon';
  compact?: boolean;
  onDirection(direction: Direction): void;
}

function DirectionCompass({
  current,
  selected,
  dataName,
  compact = false,
  onDirection,
}: CompassProps) {
  const { snapshot } = useGame();
  const { step, restricted, guided } = useTutorialControls();
  const highlighted = selected ?? current;
  const centerLabel =
    selected !== null ? 'SELECCIONADA' : current !== null ? 'ACTUAL' : 'ELIGE RUMBO';
  return (
    <div
      className={`hex-compass ${compact ? 'compact' : ''}`}
      role="group"
      aria-label="Brújula de seis direcciones"
    >
      <div className="compass-frame" aria-hidden="true" />
      <div className="compass-center" aria-hidden="true">
        <span>{centerLabel}</span>
        <strong>
          {highlighted === null ? '·' : directionName(highlighted, snapshot.viewPlayer)}
        </strong>
      </div>
      {ALL_DIRECTIONS.map((viewDirection) => {
        const direction = ((viewDirection + (snapshot.viewPlayer === 0 ? 3 : 0)) % 6) as Direction;
        const isCurrent = current === direction;
        const active = selected === direction;
        const label = DIRECTION_NAMES[viewDirection];
        return (
          <button
            key={direction}
            type="button"
            {...{ [`data-${dataName}`]: direction }}
            className={`compass-direction ${isCurrent ? 'current' : ''} ${active ? 'active' : ''}`}
            style={{ '--direction': viewDirection } as CSSProperties}
            disabled={isCurrent || (restricted && step?.direction !== direction)}
            data-tutorial-highlight={
              guided && step?.direction === direction && selected !== direction ? true : undefined
            }
            aria-label={`${label}${isCurrent ? ', orientación actual' : ''}`}
            aria-pressed={active || isCurrent}
            onClick={() => onDirection(direction)}
          >
            <i aria-hidden="true">↑</i>
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function DirectionPanel({ title, ...props }: CompassProps & { title: string }) {
  const { commands } = useGame();
  return (
    <div className="control-section direction-section">
      <h3>{title}</h3>
      <p>Elige un rumbo en la brújula.</p>
      <DirectionCompass {...props} />
      <button type="button" className="text-button cancel-mode" onClick={commands.cancelDraft}>
        Volver
      </button>
    </div>
  );
}

function ActionChoice({ action, index }: { action: GameAction; index: number }) {
  const { actionAllowed } = useTutorialControls();
  const {
    snapshot: { state },
    commands,
  } = useGame();
  const actor = getPiece(state, action.pieceId);
  const targetId =
    action.kind === 'shoot' ||
    action.kind === 'convert' ||
    action.kind === 'attackAbove' ||
    action.kind === 'attackBelow'
      ? action.targetId
      : action.kind === 'transform'
        ? action.attackAboveId
        : action.kind === 'move'
          ? action.targetId
          : undefined;
  const target = targetId ? getPiece(state, targetId) : undefined;
  const destination = actionDestination(state, action);
  const occupancy = destination ? occupancyAt(state, destination) : undefined;
  let label = target && isAirPiece(target) ? 'AIRE' : 'SUELO';
  let detail = target ? PIECE_NAMES[target.type] : 'Objetivo';
  if (action.kind === 'move' && action.kamikaze) {
    const victim = target ?? occupancy?.air ?? occupancy?.ground;
    label = 'KAMIKAZE';
    detail = `Destruir ${victim ? PIECE_NAMES[victim.type] : 'objetivo'}`;
  } else if (actor?.type === 'airplane' && action.kind === 'move' && occupancy?.ground) {
    label = 'SOBREVUELO';
    detail = `Quedar sobre ${PIECE_NAMES[occupancy.ground.type]}`;
  } else if (
    actor &&
    !isAirPiece(actor) &&
    action.kind === 'move' &&
    occupancy?.air?.type === 'airplane' &&
    occupancy.air.owner !== actor.owner
  ) {
    const attack = target?.id === occupancy.air.id;
    label = attack ? 'ATAQUE' : 'MOVIMIENTO';
    detail = attack ? 'Destruir Avión' : 'Quedar bajo Avión';
  } else if (action.kind === 'shoot') {
    label = 'DISPARO';
    detail = `Atacar ${target ? PIECE_NAMES[target.type] : 'objetivo'}`;
  }
  return (
    <button
      type="button"
      data-action-choice={index}
      disabled={!actionAllowed(action)}
      onClick={() => commands.prepareAction(action)}
    >
      <span>{label}</span>
      <strong>{detail}</strong>
    </button>
  );
}

function ActionControls({ piece, legalActions }: { piece?: Piece; legalActions: GameAction[] }) {
  const { snapshot, commands } = useGame();
  const { step, guided, actionAllowed, modeAllowed } = useTutorialControls();
  const { mode, state, pendingAction, machineSearch } = snapshot;
  if (mode.kind === 'pieceChoice')
    return (
      <div className="control-section">
        <h2>Casilla apilada</h2>
        <p>Selecciona capa para inspeccionar.</p>
        <div className="choice-list">
          {mode.pieceIds.map((id) => {
            const candidate = getPiece(state, id);
            return (
              candidate && (
                <button
                  type="button"
                  key={id}
                  data-piece-choice={id}
                  onClick={() => commands.selectPiece(id)}
                >
                  <span>{isAirPiece(candidate) ? 'AIRE' : 'SUELO'}</span>
                  <strong>{PIECE_NAMES[candidate.type]}</strong>
                </button>
              )
            );
          })}
        </div>
      </div>
    );
  if (!piece)
    return (
      snapshot.isMachineTurn && (
        <div className="control-section machine-wait">
          <span className="thinking-pulse" aria-hidden="true" />
          <strong>Máquina pensando</strong>
          <p>
            {machineSearch
              ? `Profundidad ${machineSearch.completedDepth}/${machineSearch.requestedDepth} · ${machineSearch.nodes.toLocaleString('es-ES')} posiciones`
              : 'Evaluando el frente, la seguridad y las amenazas tácticas.'}
          </p>
          <div
            className="ai-progress"
            role="progressbar"
            aria-label="Progreso de cálculo"
            aria-valuemin={0}
            aria-valuemax={machineSearch?.requestedDepth ?? 1}
            aria-valuenow={machineSearch?.completedDepth ?? 0}
          >
            <i
              style={
                {
                  '--ai-progress': machineSearch
                    ? machineSearch.completedDepth / machineSearch.requestedDepth
                    : 0,
                } as CSSProperties
              }
            />
          </div>
        </div>
      )
    );
  if (mode.kind === 'actionChoice')
    return (
      <div className="control-section">
        <h3>Elegir maniobra</h3>
        <p>Esta casilla admite varias órdenes.</p>
        <div className="choice-list">
          {mode.actions.map((action, index) => (
            <ActionChoice key={index} action={action} index={index} />
          ))}
        </div>
        <button className="text-button cancel-mode" type="button" onClick={commands.cancelDraft}>
          Volver
        </button>
      </div>
    );
  if (mode.kind === 'rotate' || mode.kind === 'orient') {
    const current =
      piece.type === 'soldier' ? piece.facing : piece.type === 'medium' ? piece.cannon : null;
    const selected =
      pendingAction?.kind === 'rotate'
        ? pendingAction.facing
        : pendingAction?.kind === 'orient'
          ? pendingAction.cannon
          : null;
    return (
      <DirectionPanel
        title={mode.kind === 'rotate' ? 'Cambiar orientación' : 'Orientar cañón'}
        current={current}
        selected={selected}
        dataName="direction-order"
        onDirection={(direction) => {
          const action = legalActions.find((candidate) =>
            mode.kind === 'rotate'
              ? candidate.kind === 'rotate' && candidate.facing === direction
              : candidate.kind === 'orient' && candidate.cannon === direction,
          );
          if (action) commands.prepareAction(action);
        }}
      />
    );
  }
  if (mode.kind === 'transform') {
    const attackAbove =
      mode.facing === null
        ? undefined
        : legalActions.find(
            (action) =>
              action.kind === 'transform' &&
              action.facing === mode.facing &&
              Boolean(action.attackAboveId),
          );
    return (
      <>
        <DirectionPanel
          title="Abandonar vehículo"
          current={null}
          selected={mode.facing}
          dataName="transform-facing"
          onDirection={(facing) => commands.setMode({ kind: 'transform', facing })}
        />
        {attackAbove && (
          <button
            type="button"
            className="stacked-response"
            data-transform-attack
            disabled={!actionAllowed(attackAbove)}
            onClick={() => commands.prepareAction(attackAbove)}
          >
            Transformarse y atacar al Dron superior
          </button>
        )}
      </>
    );
  }
  if (piece.owner !== state.activePlayer || state.outcome)
    return (
      <div className="control-section muted-section">
        <strong>Vista rival</strong>
        <p>
          Los marcadores atenuados muestran sus desplazamientos y ataques potenciales. No puedes
          ejecutar esas órdenes.
        </p>
      </div>
    );
  const above = legalActions.find((action) => action.kind === 'attackAbove');
  const below = legalActions.find((action) => action.kind === 'attackBelow');
  const captureAbove = legalActions.find(
    (action): action is Extract<GameAction, { kind: 'convert' }> => {
      if (action.kind !== 'convert') return false;
      const target = getPiece(state, action.targetId);
      return Boolean(target && equalHex(target.position, piece.position) && isAirPiece(target));
    },
  );
  const target = captureAbove ? getPiece(state, captureAbove.targetId) : undefined;
  return (
    <div className="command-buttons">
      {legalActions.some((action) => action.kind === 'rotate') && (
        <button
          type="button"
          data-command="rotate"
          disabled={!modeAllowed('rotate')}
          data-tutorial-highlight={guided && step?.mode === 'rotate' ? true : undefined}
          onClick={() => commands.setMode({ kind: 'rotate' })}
        >
          Cambiar orientación
        </button>
      )}
      {legalActions.some((action) => action.kind === 'orient') && (
        <button
          type="button"
          data-command="orient"
          disabled={!modeAllowed('orient')}
          data-tutorial-highlight={guided && step?.mode === 'orient' ? true : undefined}
          onClick={() => commands.setMode({ kind: 'orient' })}
        >
          Orientar cañón
        </button>
      )}
      {above && (
        <button
          type="button"
          data-command="above"
          disabled={!actionAllowed(above)}
          data-tutorial-highlight={
            guided && actionAllowed(above) && !pendingAction ? true : undefined
          }
          onClick={() => commands.prepareAction(above)}
        >
          Atacar aeronave superior
        </button>
      )}
      {below && (
        <button
          type="button"
          data-command="below"
          disabled={!actionAllowed(below)}
          data-tutorial-highlight={
            guided && actionAllowed(below) && !pendingAction ? true : undefined
          }
          onClick={() => commands.prepareAction(below)}
        >
          Atacar unidad inferior
        </button>
      )}
      {captureAbove && target && (
        <button
          type="button"
          data-command="capture-above"
          disabled={!actionAllowed(captureAbove)}
          data-tutorial-highlight={
            guided && actionAllowed(captureAbove) && !pendingAction ? true : undefined
          }
          onClick={() => commands.prepareAction(captureAbove)}
        >
          {captureAboveCommandLabel(target.type)}
        </button>
      )}
      {legalActions.some((action) => action.kind === 'transform') && (
        <button
          type="button"
          className="danger-command"
          data-command="transform"
          disabled={!modeAllowed('transform')}
          data-tutorial-highlight={guided && step?.mode === 'transform' ? true : undefined}
          onClick={() => commands.setMode({ kind: 'transform', facing: null })}
        >
          Abandonar vehículo
        </button>
      )}
    </div>
  );
}

function PendingCard({ piece, legalActions }: { piece?: Piece; legalActions: GameAction[] }) {
  const { guided, actionAllowed } = useTutorialControls();
  const {
    snapshot: { state, pendingAction: action, animating },
    commands,
  } = useGame();
  const cannon =
    piece?.type === 'medium' && action?.kind === 'move' ? (action.cannon ?? piece.cannon) : null;
  return (
    <div id="pending-card" className="pending-card" hidden={!action}>
      {action && (
        <>
          <div className="pending-label">
            <span>ORDEN PREPARADA</span>
            <i />
          </div>
          <strong>{describeAction(state, action)}</strong>
          {piece?.type === 'medium' && action.kind === 'move' && (
            <div className="inline-direction">
              <span>Cañón tras mover</span>
              <DirectionCompass
                current={null}
                selected={cannon}
                dataName="pending-cannon"
                compact
                onDirection={(direction) => {
                  const replacement = legalActions.find(
                    (candidate) =>
                      candidate.kind === 'move' &&
                      equalHex(candidate.to, action.to) &&
                      candidate.cannon === direction,
                  );
                  if (replacement) commands.prepareAction(replacement);
                }}
              />
            </div>
          )}
          {action.kind === 'transform' && !action.to && !action.attackAboveId && (
            <p className="transform-warning">
              <WarningIcon className="transform-warning-icon" />
              <span>
                Para realizar un desplazamiento o ataque como soldado en este mismo turno,
                selecciona la casilla de destino antes de confirmar
              </span>
            </p>
          )}
          <div className="pending-actions">
            <button
              type="button"
              className="secondary-button cancel-selection"
              id="cancel-selection"
              disabled={animating}
              onClick={commands.cancelDraft}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="confirm-button"
              disabled={animating || !actionAllowed(action)}
              data-tutorial-highlight={guided && actionAllowed(action) ? true : undefined}
              onClick={() => void commands.commitPending()}
            >
              Confirmar acción
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function CommandPanel() {
  const { snapshot, commands } = useGame();
  const tutorialStep = snapshot.tutorial ? TUTORIAL_STEPS[snapshot.tutorial.stepIndex] : undefined;
  const panelRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<FloatingPanel | null>(null);
  const focusedControl = useRef<HTMLElement | null>(null);
  const piece = snapshot.selectedId ? getPiece(snapshot.state, snapshot.selectedId) : undefined;
  const legalActions =
    piece?.owner === snapshot.state.activePlayer
      ? getLegalActionsForPiece(snapshot.state, piece.id)
      : [];
  const visible =
    (!tutorialStep || tutorialStep.section >= 3) &&
    (Boolean(piece) || snapshot.mode.kind === 'pieceChoice');
  const closePanel = useCallback(() => {
    commands.clearSelection();
    document.getElementById('game-canvas')?.focus({ preventScroll: true });
    commands.announce('Panel de mando cerrado. Unidad deseleccionada.');
  }, [commands]);
  useLayoutEffect(() => {
    floatingRef.current?.reveal();
  }, [snapshot.selectedId, snapshot.pendingAction, snapshot.mode]);
  useLayoutEffect(() => {
    const previous = focusedControl.current;
    if (!previous || previous.isConnected || document.activeElement !== document.body) return;
    const attribute = previous.getAttributeNames().find((name) => name.startsWith('data-'));
    const value = attribute ? previous.getAttribute(attribute) : null;
    const selector = previous.id
      ? `#${CSS.escape(previous.id)}`
      : attribute && value !== null
        ? `[${attribute}="${CSS.escape(value)}"]`
        : '';
    const replacement = selector ? panelRef.current?.querySelector<HTMLElement>(selector) : null;
    const fallback =
      panelRef.current?.querySelector<HTMLElement>('#pending-card:not([hidden]) .confirm-button') ??
      panelRef.current?.querySelector<HTMLElement>('#action-controls button:not(:disabled)') ??
      panelRef.current?.querySelector<HTMLElement>('#close-command-panel:not(:disabled)') ??
      panelRef.current?.querySelector<HTMLElement>('#command-window-titlebar');
    (replacement ?? fallback)?.focus();
  }, [snapshot.selectedId, snapshot.pendingAction, snapshot.mode]);
  return (
    <FloatingPanelWindow
      kind="command"
      visible={visible}
      controlsDisabled={Boolean(snapshot.tutorial)}
      panelRef={panelRef}
      controllerRef={floatingRef}
      onClose={closePanel}
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement) focusedControl.current = event.target;
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) focusedControl.current = null;
      }}
    >
      <div
        id="command-window-content"
        className={`command-window-content${tutorialStep?.id === '3.2' ? ' tutorial-panel-emphasis' : ''}`}
        inert={tutorialStep?.id === '3.1'}
      >
        <PieceCard piece={piece} />
        <div id="action-controls" className="action-controls">
          <ActionControls piece={piece} legalActions={legalActions} />
        </div>
        <PendingCard piece={piece} legalActions={legalActions} />
      </div>
    </FloatingPanelWindow>
  );
}

export function BattleLog() {
  const { snapshot, commands } = useGame();
  const panelRef = useRef<HTMLElement>(null);
  const floatingRef = useRef<FloatingPanel | null>(null);
  const closePanel = useCallback(() => {
    commands.setLogOpen(false);
    document.getElementById('log-toggle')?.focus({ preventScroll: true });
  }, [commands]);
  return (
    <FloatingPanelWindow
      kind="battle-log"
      visible={snapshot.logOpen}
      panelRef={panelRef}
      controllerRef={floatingRef}
      onClose={closePanel}
    >
      <ol id="battle-log" className="battle-log">
        {snapshot.state.history.length ? (
          [...snapshot.state.history].reverse().map((entry) => (
            <li
              key={`${entry.id}:${entry.player}:${entry.text}`}
              className={`player-${entry.player === 0 ? 'blue' : 'amber'}`}
            >
              <span>{entry.id}</span>
              <p>{entry.text}</p>
            </li>
          ))
        ) : (
          <li className="empty-log">Todavía no hay órdenes ejecutadas.</li>
        )}
      </ol>
    </FloatingPanelWindow>
  );
}

export function ScreenReaderBoard() {
  const { snapshot } = useGame();
  const { state, selectedId, visibleActions, focusedHex, viewPlayer, firingRange } = snapshot;
  const inspected = selectedId ? getPiece(state, selectedId) : undefined;
  const actionLabel =
    inspected?.owner !== state.activePlayer ? 'Amenazas potenciales' : 'Acciones legales';
  const ranges = new Set(firingRange.map(hexKey));
  return (
    <div
      id="sr-board"
      className="sr-only"
      role="rowgroup"
      aria-label="Representación textual del tablero"
    >
      {Array.from({ length: 11 }, (_, row) => {
        const r = row - 5;
        return (
          <div key={r} role="row" aria-rowindex={r + 6}>
            {Array.from({ length: 11 }, (_, column) => {
              const q = column - 5;
              const hex = { q, r };
              if (!isOnBoard(hex)) return null;
              const occupancy = occupancyAt(state, hex);
              const pieces = [occupancy.ground, occupancy.air]
                .filter((piece): piece is Piece => Boolean(piece))
                .map((piece) => pieceAccessibleLabel(state, piece, viewPlayer));
              const legal = [
                ...new Set(
                  actionsAtHex(state, visibleActions, hex).map((action) =>
                    describeAction(state, action),
                  ),
                ),
              ];
              const rangeLabel = ranges.has(hexKey(hex)) ? '. Alcance potencial de disparo' : '';
              const label = `${pieces.length ? pieces.join('. ') : `Casilla ${q}, ${r}, vacía`}${rangeLabel}${legal.length ? `. ${actionLabel}: ${legal.join('; ')}` : ''}`;
              return (
                <div
                  key={q}
                  id={accessibleCellId(hex)}
                  role="gridcell"
                  aria-rowindex={r + 6}
                  aria-colindex={q + 6}
                  aria-selected={Boolean(focusedHex && equalHex(focusedHex, hex))}
                  data-hex={hexKey(hex)}
                >
                  {label}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
