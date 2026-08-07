import './styles.css';

import { WorkerAiStrategy, difficultyBudget } from './ai-strategy';
import { AudioDirector } from './audio';
import { createClassicConfig } from './game-config';
import {
  ALL_DIRECTIONS,
  DIRECTION_NAMES,
  directionBetween,
  equalHex,
  hexKey,
  isOnBoard,
  stepHex,
} from './hex';
import {
  PIECE_NAMES,
  PLAYER_NAMES,
  actionDestination,
  applyAction,
  createInitialState,
  declareBlockade,
  describeAction,
  getFiringRangeCells,
  getLegalActionsForPiece,
  getPiece,
  getPreviewActionsForPiece,
  isAirPiece,
  occupancyAt,
  outcomeText,
} from './engine';
import {
  appendAction,
  calculateStatistics,
  createMatchRecord,
  parseRecord,
  replayRecord,
  serializeRecord,
} from './match-record';
import { MatchController } from './match-controller';
import {
  clearActiveMatch,
  completeScenario,
  loadAcademyProgress,
  loadActiveMatch,
  loadPreferences,
  saveActiveMatch,
  savePreferences as persistPreferences,
} from './match-storage';
import { BoardRenderer, actionsAtHex, pieceAccessibleLabel, type RenderModel } from './renderer';
import { SCENARIOS, evaluateScenario, scenarioById } from './scenarios';
import {
  loadScenarioCatalog,
  saveCustomScenario,
  validateCustomScenario,
  type CustomScenario,
} from './scenario-catalog';
import type {
  Direction,
  GameAction,
  GameEvent,
  GameMode,
  GamePreferences,
  Hex,
  MatchConfig,
  MatchRecord,
  Piece,
  ScenarioDefinition,
} from './types';

type UiMode =
  | { kind: 'default' }
  | { kind: 'rotate' }
  | { kind: 'orient' }
  | { kind: 'transform'; facing: Direction | null }
  | { kind: 'actionChoice'; actions: GameAction[] }
  | { kind: 'pieceChoice'; pieceIds: string[] };

interface PointerState {
  x: number;
  y: number;
  startX: number;
  startY: number;
  moved: boolean;
}

const canvas = requireElement<HTMLCanvasElement>('game-canvas');
const renderer = new BoardRenderer(canvas);
const preferences = loadPreferences();
const audio = new AudioDirector(preferences);
const aiStrategy = new WorkerAiStrategy();
audio.setEnabled(preferences.sound);

let state = createInitialState();
let selectedId: string | null = null;
let pendingAction: GameAction | null = null;
let mode: UiMode = { kind: 'default' };
let hoveredHex: Hex | null = null;
let focusedHex: Hex | null = { q: 0, r: 0 };
let visibleActions: GameAction[] = [];
let lastEvents: GameEvent[] = [];
let animating = false;
let gameMode: GameMode | null = null;
let matchConfig: MatchConfig | null = null;
let matchRecord: MatchRecord | null = null;
let matchController: MatchController | null = null;
let activeScenario: ScenarioDefinition | null = null;
let aiAbortController: AbortController | null = null;
let replayDock: HTMLElement | null = null;
let machineThinking = false;
let logOpen = false;
let renderedStatusKey = '';

const pointers = new Map<number, PointerState>();
let previousPinchDistance = 0;
let previousPinchCenter: { x: number; y: number } | null = null;
let multiPointerGesture = false;

const pieceCard = requireElement<HTMLElement>('piece-card');
const actionControls = requireElement<HTMLElement>('action-controls');
const pendingCard = requireElement<HTMLElement>('pending-card');
const selectionSummary = requireElement<HTMLElement>('selection-summary');
const turnChip = requireElement<HTMLElement>('turn-chip');
const blueFortress = requireElement<HTMLElement>('blue-fortress');
const amberFortress = requireElement<HTMLElement>('amber-fortress');
const battleLog = requireElement<HTMLOListElement>('battle-log');
const logToggle = requireElement<HTMLButtonElement>('log-toggle');
const soundButton = requireElement<HTMLButtonElement>('sound-button');
const blockadeButton = requireElement<HTMLButtonElement>('blockade-button');
const mobileNewGameButton = requireElement<HTMLButtonElement>('mobile-new-game-button');
const dialog = requireElement<HTMLDialogElement>('game-dialog');
const toastRegion = requireElement<HTMLElement>('toast-region');
const announcer = requireElement<HTMLElement>('announcer');
const srBoard = requireElement<HTMLElement>('sr-board');

applyPreferences();
bindControls();
render();
showGameModeDialog(true);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}

function bindControls(): void {
  requireElement<HTMLButtonElement>('zoom-in').addEventListener('click', () =>
    renderer.zoomBy(1.16),
  );
  requireElement<HTMLButtonElement>('zoom-out').addEventListener('click', () =>
    renderer.zoomBy(1 / 1.16),
  );
  requireElement<HTMLButtonElement>('reset-view').addEventListener('click', () =>
    renderer.resetView(),
  );
  requireElement<HTMLButtonElement>('new-game-button').addEventListener('click', showNewGameDialog);
  mobileNewGameButton.addEventListener('click', showNewGameDialog);
  requireElement<HTMLButtonElement>('help-button').addEventListener('click', showHelpDialog);
  requireElement<HTMLButtonElement>('settings-button').addEventListener(
    'click',
    showSettingsDialog,
  );
  blockadeButton.addEventListener('click', showBlockadeDialog);

  soundButton.addEventListener('click', () => {
    preferences.sound = audio.toggle();
    savePreferences();
    renderSoundButton();
  });

  const activateAudio = (): void => {
    void audio.startMusic().then((started) => {
      if (!started) return;
      window.removeEventListener('pointerdown', activateAudio, true);
      window.removeEventListener('keydown', activateAudio, true);
    });
  };
  void audio.startMusic();
  window.addEventListener('pointerdown', activateAudio, { capture: true });
  window.addEventListener('keydown', activateAudio, { capture: true });

  logToggle.addEventListener('click', () => {
    logOpen = !logOpen;
    renderBattleLog();
  });

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', () => {
    if (pointers.size === 0) {
      hoveredHex = null;
      syncCanvas();
    }
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      renderer.zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
    },
    { passive: false },
  );
  canvas.addEventListener('keydown', onCanvasKeyDown);

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || dialog.open) return;
    if (pendingAction || mode.kind !== 'default') cancelDraft();
    else if (selectedId) clearSelection();
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && gameMode !== null) dialog.close();
  });
  dialog.addEventListener('cancel', (event) => {
    if (gameMode === null) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    if (!dialog.open) unlockPageScroll();
  });
  const preventBackgroundScroll = (event: Event): void => {
    if (dialog.open && event.target instanceof Node && !dialog.contains(event.target)) {
      event.preventDefault();
    }
  };
  document.addEventListener('wheel', preventBackgroundScroll, {
    capture: true,
    passive: false,
  });
  document.addEventListener('touchmove', preventBackgroundScroll, {
    capture: true,
    passive: false,
  });
}

function onPointerDown(event: PointerEvent): void {
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  });
  if (pointers.size >= 2) {
    multiPointerGesture = true;
    for (const tracked of pointers.values()) tracked.moved = true;
    updatePinchBaseline();
  }
}

function onPointerMove(event: PointerEvent): void {
  const pointer = pointers.get(event.pointerId);
  if (!pointer) {
    if (event.pointerType === 'mouse') {
      hoveredHex = renderer.clientToHex(event.clientX, event.clientY);
      syncCanvas();
    }
    return;
  }

  const oldX = pointer.x;
  const oldY = pointer.y;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 5) pointer.moved = true;

  if (pointers.size === 1 && pointer.moved) {
    renderer.panBy(pointer.x - oldX, pointer.y - oldY);
  } else if (pointers.size === 2) {
    for (const tracked of pointers.values()) tracked.moved = true;
    const [first, second] = [...pointers.values()];
    const distance = Math.hypot(first.x - second.x, first.y - second.y);
    const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    if (previousPinchDistance > 0) {
      renderer.zoomBy(distance / previousPinchDistance, center.x, center.y);
    }
    if (previousPinchCenter) {
      renderer.panBy(center.x - previousPinchCenter.x, center.y - previousPinchCenter.y);
    }
    previousPinchDistance = distance;
    previousPinchCenter = center;
  }
}

function onPointerUp(event: PointerEvent): void {
  const pointer = pointers.get(event.pointerId);
  const wasSingle = pointers.size === 1;
  pointers.delete(event.pointerId);
  if (pointer && wasSingle && !pointer.moved && !multiPointerGesture) {
    const hex = renderer.clientToHex(event.clientX, event.clientY);
    if (hex) handleCell(hex);
  }
  if (pointers.size < 2) {
    previousPinchDistance = 0;
    previousPinchCenter = null;
  } else {
    updatePinchBaseline();
  }
  if (pointers.size === 0) multiPointerGesture = false;
}

function onPointerCancel(event: PointerEvent): void {
  pointers.delete(event.pointerId);
  previousPinchDistance = 0;
  previousPinchCenter = null;
  if (pointers.size === 0) multiPointerGesture = false;
}

function updatePinchBaseline(): void {
  const [first, second] = [...pointers.values()];
  if (!first || !second) return;
  previousPinchDistance = Math.hypot(first.x - second.x, first.y - second.y);
  previousPinchCenter = {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function onCanvasKeyDown(event: KeyboardEvent): void {
  const shortcut = event.key.toLowerCase();
  if (shortcut === 'h') {
    event.preventDefault();
    showHelpDialog();
    return;
  }
  if (shortcut === 'l') {
    event.preventDefault();
    logOpen = !logOpen;
    renderBattleLog();
    logToggle.focus();
    return;
  }
  if (shortcut === 'c') {
    event.preventDefault();
    renderer.resetView();
    announce('Tablero centrado.');
    return;
  }
  if (shortcut === 'u') {
    event.preventDefault();
    focusNextOwnUnit(event.shiftKey ? -1 : 1);
    return;
  }
  const blueDirections: Record<string, Direction> = {
    q: 4,
    w: 3,
    e: 2,
    a: 5,
    s: 0,
    d: 1,
    '7': 4,
    '8': 3,
    '9': 2,
    '4': 5,
    '2': 0,
    '6': 1,
  };
  const modelDirection = blueDirections[event.key.toLowerCase()];
  const direction =
    modelDirection === undefined
      ? undefined
      : (((modelDirection + (viewPlayer() === 0 ? 0 : 3)) % 6) as Direction);
  if (direction !== undefined) {
    event.preventDefault();
    const next = stepHex(focusedHex ?? { q: 0, r: 0 }, direction);
    if (isOnBoard(next)) {
      focusedHex = next;
      announceCell(next);
      renderScreenReaderBoard();
      syncCanvas();
    }
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (focusedHex && pendingAction) {
      const destination = actionDestination(state, pendingAction);
      if (destination && equalHex(destination, focusedHex)) {
        void commitPending();
        return;
      }
    }
    if (focusedHex) handleCell(focusedHex);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (pendingAction || mode.kind !== 'default') cancelDraft();
    else clearSelection();
  }
}

function focusNextOwnUnit(offset: -1 | 1): void {
  const units = state.pieces
    .filter((piece) => piece.owner === state.activePlayer)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!units.length) return;
  const currentIndex = units.findIndex((piece) => piece.id === selectedId);
  const nextIndex = (currentIndex + offset + units.length) % units.length;
  selectPiece(units[nextIndex].id);
}

function handleCell(hex: Hex): void {
  if (animating || isMachineTurn() || replayDock) return;
  focusedHex = hex;
  if (pendingAction) {
    const destination = actionDestination(state, pendingAction);
    if (destination && equalHex(destination, hex)) {
      void commitPending();
      return;
    }
  }
  const selected = selectedId ? getPiece(state, selectedId) : undefined;
  if (selected && equalHex(selected.position, hex)) {
    clearSelection();
    announce('Unidad deseleccionada.');
    return;
  }
  if (!state.outcome && selected?.owner === state.activePlayer) {
    const matching = actionsAtHex(state, visibleActions, hex);
    if (matching.length === 1) {
      setPending(matching[0]);
      return;
    }
    if (matching.length > 1) {
      mode = { kind: 'actionChoice', actions: matching };
      pendingAction = null;
      render();
      announce('Hay varias maniobras en esa casilla. Elige la orden en el panel.');
      return;
    }
  }

  const occupancy = occupancyAt(state, hex);
  const pieces = [occupancy.ground, occupancy.air].filter((piece): piece is Piece =>
    Boolean(piece),
  );
  if (pieces.length === 0) {
    clearSelection();
  } else if (pieces.length === 1) {
    selectPiece(pieces[0].id);
  } else {
    selectedId = null;
    mode = { kind: 'pieceChoice', pieceIds: pieces.map((piece) => piece.id) };
    pendingAction = null;
    render();
    announce('Casilla apilada. Elige unidad de aire o suelo.');
  }
}

function selectPiece(pieceId: string): void {
  const piece = getPiece(state, pieceId);
  if (!piece) return;
  selectedId = pieceId;
  focusedHex = { ...piece.position };
  pendingAction = null;
  mode = { kind: 'default' };
  audio.playSelect();
  render();
  announce(
    `${pieceAccessibleLabel(state, piece, viewPlayer())}. ${piece.owner === state.activePlayer ? 'Unidad lista.' : 'Unidad rival.'}`,
  );
}

function clearSelection(): void {
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  render();
}

function cancelDraft(): void {
  pendingAction = null;
  mode = { kind: 'default' };
  render();
  announce('Orden cancelada.');
}

function setPending(action: GameAction): void {
  pendingAction = action;
  if (mode.kind === 'actionChoice') mode = { kind: 'default' };
  render();
  const requiresConfirmation = shouldConfirmAction(action);
  announce(
    `${describeAction(state, action)}.${requiresConfirmation ? ' Pulsa confirmar para ejecutar.' : ' Ejecutando orden.'}`,
  );
  if (!requiresConfirmation) void executeTurn(action);
}

function shouldConfirmAction(action: GameAction): boolean {
  if (preferences.confirmation === 'always') return true;
  if (preferences.confirmation === 'quick') return action.kind === 'transform';
  const preview = applyAction(state, action);
  if (!preview.ok) return true;
  const enemy = state.activePlayer === 0 ? 1 : 0;
  const oldEnemy = state.pieces.filter((piece) => piece.owner === enemy).length;
  const newEnemy = preview.state.pieces.filter((piece) => piece.owner === enemy).length;
  return (
    newEnemy < oldEnemy ||
    preview.events.some((event) => event.type === 'fortressDamage' || event.type === 'intercept') ||
    action.kind === 'transform'
  );
}

async function commitPending(): Promise<void> {
  if (!pendingAction || animating || isMachineTurn()) return;
  await executeTurn(pendingAction);
}

async function executeTurn(action: GameAction): Promise<void> {
  if (animating) return;
  const before = state;
  const result = matchController ? matchController.commit(action) : applyAction(state, action);
  if (!result.ok) {
    audio.playInvalid();
    showToast(result.error ?? 'Orden rechazada.');
    return;
  }

  state = result.state;
  const scenarioCompleted = activeScenario
    ? evaluateScenario(activeScenario, before, state, action)
    : false;
  if (activeScenario) state = { ...state, outcome: null };
  if (matchController) matchRecord = matchController.record;
  else if (matchRecord) matchRecord = appendAction(matchRecord, action);
  if (matchRecord) {
    try {
      saveActiveMatch(matchRecord);
    } catch {
      showToast('No se pudo guardar la partida en este navegador.');
    }
  }
  lastEvents = activeScenario
    ? result.events.filter((event) => event.type !== 'draw' && event.type !== 'victory')
    : result.events;
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  animating = true;
  audio.playEvents(result.events, before);
  render();
  try {
    await renderer.playEvents(result.events, before, preferences.reducedMotion);
    if (!state.outcome && !preferences.fixedBoard)
      await renderer.rotateToPlayer(viewPlayer(), preferences.reducedMotion);
  } finally {
    animating = false;
    render();
  }

  if (activeScenario && scenarioCompleted) {
    completeScenario(activeScenario.id);
    showScenarioSuccess(activeScenario);
  } else if (activeScenario) {
    showScenarioRetry(activeScenario);
  } else if (state.outcome) {
    announce(outcomeText(state.outcome));
    showOutcomeDialog();
  } else {
    audio.playTurn();
    announce(`Turno de ${PLAYER_NAMES[state.activePlayer]}.`);
    if (gameMode === 'local' && preferences.handoffScreen) showHandoffDialog();
    else if (isMachineTurn()) void runMachineTurn();
  }
}

async function runMachineTurn(): Promise<void> {
  if (!isMachineTurn() || state.outcome || animating) return;
  machineThinking = true;
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  render();
  announce('Turno de la máquina. Pensando jugada.');
  await new Promise<void>((resolve) =>
    window.setTimeout(resolve, preferences.reducedMotion ? 80 : 550),
  );
  if (!isMachineTurn() || state.outcome) {
    machineThinking = false;
    render();
    return;
  }
  aiAbortController?.abort();
  aiAbortController = new AbortController();
  const difficulty = matchConfig?.participants[1].difficulty ?? 'recruit';
  const action = matchConfig
    ? await aiStrategy.chooseAction(state, matchConfig, {
        maxMs: difficultyBudget(difficulty, window.innerWidth < 700),
        signal: aiAbortController.signal,
      })
    : null;
  machineThinking = false;
  if (!action) {
    render();
    return;
  }
  await executeTurn(action);
}

function isMachineTurn(): boolean {
  return gameMode === 'machine' && state.activePlayer === 1;
}

function render(): void {
  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const restoreDynamicFocus = Boolean(
    activeElement &&
    (actionControls.contains(activeElement) || pendingCard.contains(activeElement)),
  );
  const focusAttribute = activeElement
    ?.getAttributeNames()
    .find((name) => name.startsWith('data-'));
  const focusValue = focusAttribute ? activeElement?.getAttribute(focusAttribute) : null;
  const selected = selectedId ? getPiece(state, selectedId) : undefined;
  if (selectedId && !selected) {
    selectedId = null;
    pendingAction = null;
    mode = { kind: 'default' };
  }
  const actionable = selected?.owner === state.activePlayer;
  const legalActions = actionable && selectedId ? getLegalActionsForPiece(state, selectedId) : [];
  const displayActions = selectedId
    ? actionable
      ? legalActions
      : getPreviewActionsForPiece(state, selectedId)
    : [];
  visibleActions = filterVisibleActions(displayActions, selected);
  renderStatus();
  renderPieceCard(selected);
  renderActionControls(selected, legalActions);
  renderPendingCard(selected, legalActions);
  renderBattleLog();
  renderSoundButton();
  renderScreenReaderBoard();
  syncCanvas();
  if (restoreDynamicFocus) {
    queueMicrotask(() => {
      const selector =
        focusAttribute && typeof focusValue === 'string'
          ? `[${focusAttribute}="${CSS.escape(focusValue)}"]`
          : '';
      const replacement = selector ? document.querySelector<HTMLElement>(selector) : null;
      replacement?.focus();
      if (!replacement) {
        pendingCard.querySelector<HTMLElement>('.confirm-button')?.focus();
        if (document.activeElement === activeElement || document.activeElement === document.body) {
          actionControls.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
        }
      }
    });
  }
}

function syncCanvas(): void {
  const model: RenderModel = {
    state,
    selectedId,
    actions: visibleActions,
    pending: pendingAction,
    hovered: hoveredHex,
    focused: focusedHex,
    firingRange: currentFiringRange(),
    lastEvents,
    reducedMotion: preferences.reducedMotion,
    highContrast: preferences.highContrast,
  };
  renderer.setModel(model);
}

function currentFiringRange(): Hex[] {
  const selected = selectedId ? getPiece(state, selectedId) : undefined;
  if (!selected) return [];
  if (selected.owner !== state.activePlayer) return getFiringRangeCells(state, selected.id);
  return getFiringRangeCells(state, selected.id, firingRangePreview(selected));
}

function firingRangePreview(
  piece: Piece,
): { position?: Hex; cannon?: Direction; facing?: Direction } | undefined {
  const action = pendingAction;
  if (!action || action.pieceId !== piece.id) return undefined;
  if (action.kind === 'orient') return { cannon: action.cannon };
  if (action.kind === 'move') {
    return {
      position: action.to,
      cannon: piece.type === 'medium' ? (action.cannon ?? piece.cannon) : undefined,
      facing:
        piece.type === 'airplane'
          ? (directionBetween(piece.position, action.to) ?? piece.facing)
          : undefined,
    };
  }
  return undefined;
}

function filterVisibleActions(actions: GameAction[], selected?: Piece): GameAction[] {
  if (mode.kind === 'actionChoice') return mode.actions;
  if (mode.kind === 'pieceChoice' || mode.kind === 'rotate' || mode.kind === 'orient') return [];
  if (mode.kind === 'transform') {
    if (mode.facing === null) return [];
    const facing = mode.facing;
    return actions.filter(
      (action) =>
        action.kind === 'transform' &&
        action.facing === facing &&
        (Boolean(action.to) || Boolean(action.attackAboveId)),
    );
  }
  return actions.filter((action) => {
    if (action.kind === 'rotate' || action.kind === 'orient' || action.kind === 'transform')
      return false;
    if (selected?.type === 'medium' && action.kind === 'move') {
      return action.cannon === selected.cannon;
    }
    return true;
  });
}

function renderStatus(): void {
  blockadeButton.disabled = Boolean(state.outcome) || animating || gameMode === 'machine';
  blockadeButton.hidden = gameMode === 'machine';
  const fortressState = state.pieces
    .filter((piece) => piece.type === 'fortress')
    .map((piece) => `${piece.owner}:${piece.hp}`)
    .sort()
    .join('|');
  const statusKey = `${state.activePlayer}:${state.ply}:${fortressState}:${JSON.stringify(state.outcome)}:${gameMode}:${machineThinking}`;
  if (statusKey === renderedStatusKey) return;
  renderedStatusKey = statusKey;
  renderFortressStatus(0, blueFortress);
  renderFortressStatus(1, amberFortress);
  if (state.outcome) {
    turnChip.className = 'turn-chip finished';
    turnChip.innerHTML = `<span>PARTIDA FINALIZADA</span><strong>${escapeHtml(outcomeText(state.outcome))}</strong>`;
  } else {
    const playerClass = state.activePlayer === 0 ? 'blue' : 'amber';
    turnChip.className = `turn-chip ${playerClass}`;
    const commander = isMachineTurn()
      ? machineThinking
        ? 'Máquina pensando…'
        : 'Máquina en mando'
      : `${PLAYER_NAMES[state.activePlayer]} en mando`;
    turnChip.innerHTML = `<span>TURNO ${Math.floor(state.ply / 2) + 1}</span><strong>${commander}</strong>`;
  }
}

function renderFortressStatus(player: 0 | 1, element: HTMLElement): void {
  const fortress = state.pieces.find(
    (piece) => piece.type === 'fortress' && piece.owner === player,
  );
  const hp = fortress?.type === 'fortress' ? fortress.hp : 0;
  element.innerHTML = `
    ${factionMarkMarkup(player)}
    <div><small>${PLAYER_NAMES[player]}</small><strong>Fortaleza</strong></div>
    <span class="hp" role="img" aria-label="${hp} de 2 puntos de vida">
      ${[1, 2].map((point) => `<i class="${hp >= point ? 'active' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s-8.5-5.2-8.5-12A4.5 4.5 0 0 1 12 6.9 4.5 4.5 0 0 1 20.5 9c0 6.8-8.5 12-8.5 12Z"/></svg></i>`).join('')}
    </span>`;
}

function factionMarkMarkup(player: 0 | 1): string {
  const sigil =
    player === 0
      ? `<circle class="faction-mark-core" cx="16" cy="16" r="5.25"/>
         <path class="faction-mark-detail" d="M16 5.5v5M16 21.5v5M5.5 16h5M21.5 16h5"/>
         <circle class="faction-mark-node" cx="16" cy="16" r="1.8"/>`
      : `<path class="faction-mark-core" d="m16 8 8 8-8 8-8-8Z"/>
         <path class="faction-mark-detail" d="m16 4 3.2 5.2M28 16l-5.2 3.2M16 28l-3.2-5.2M4 16l5.2-3.2"/>
         <path class="faction-mark-node" d="m16 12 4 4-4 4-4-4Z"/>`;
  return `<span class="faction-mark" aria-hidden="true">
    <svg viewBox="0 0 32 32">
      <path class="faction-mark-frame" d="M16 2.75 27.5 9.4v13.2L16 29.25 4.5 22.6V9.4Z"/>
      ${sigil}
    </svg>
  </span>`;
}

function renderPieceCard(piece?: Piece): void {
  if (!piece) {
    pieceCard.className = 'piece-card empty-state';
    pieceCard.innerHTML = `
      <div class="empty-radar" aria-hidden="true"><i></i><i></i><i></i></div>
      <h2>Esperando selección</h2>
      <p>Toca una unidad. Destinos legales aparecerán directamente sobre el tablero.</p>
      <span class="key-map">Teclado: W A S D · Enter</span>`;
    selectionSummary.textContent = activeScenario
      ? `Objetivo: ${activeScenario.summary} · ${activeScenario.hints[0]}`
      : state.outcome
        ? outcomeText(state.outcome)
        : isMachineTurn()
          ? 'La máquina está calculando su siguiente orden.'
          : `Turno de ${PLAYER_NAMES[state.activePlayer]}. Selecciona una unidad propia.`;
    return;
  }

  const ownTurn = piece.owner === state.activePlayer && !state.outcome;
  const facing =
    piece.type === 'soldier'
      ? `<span>Orientación <strong>${directionNameForView(piece.facing)}</strong></span>`
      : piece.type === 'airplane'
        ? `<span>Orientación <strong>${directionNameForView(piece.facing)}</strong></span>`
        : piece.type === 'medium'
          ? `<span>Cañón <strong>${directionNameForView(piece.cannon)}</strong></span>`
          : piece.type === 'fortress'
            ? `<span>Integridad <strong>${piece.hp}/2 HP</strong></span>`
            : '';
  const layer = isAirPiece(piece) ? 'Aire' : 'Suelo';
  const q = piece.position.q >= 0 ? `+${piece.position.q}` : `${piece.position.q}`;
  const r = piece.position.r >= 0 ? `+${piece.position.r}` : `${piece.position.r}`;
  pieceCard.className = `piece-card player-${piece.owner === 0 ? 'blue' : 'amber'}`;
  pieceCard.innerHTML = `
    <div class="piece-title-row">
      <div class="piece-monogram">${pieceMonogram(piece)}</div>
      <div><span class="eyebrow">${PLAYER_NAMES[piece.owner]} · ${layer}</span><h2>${PIECE_NAMES[piece.type]}</h2></div>
      <span class="unit-state ${ownTurn ? 'ready' : ''}">${ownTurn ? 'LISTA' : 'INSPECCIÓN'}</span>
    </div>
    <p>${pieceDescription(piece)}</p>
    <div class="piece-stats"><span>Coordenadas <strong>${q}, ${r}</strong></span>${facing}</div>`;
  selectionSummary.textContent =
    activeScenario && ownTurn
      ? `Objetivo: ${activeScenario.summary} · ${activeScenario.hints.join(' ')}`
      : ownTurn
        ? preferences.contextualHints
          ? contextualHint(piece)
          : `${PIECE_NAMES[piece.type]} seleccionada · elige una orden o un destino marcado.`
        : `${PIECE_NAMES[piece.type]} de ${PLAYER_NAMES[piece.owner]} · inspección táctica; sus amenazas aparecen atenuadas.`;
}

function contextualHint(piece: Piece): string {
  const hints: Record<Piece['type'], string> = {
    soldier: 'Consejo · El Soldado avanza por su arco frontal; girarlo también consume el turno.',
    capturer: 'Consejo · El Capturador convierte una unidad adyacente sin desplazarse.',
    medium: 'Consejo · El Tanque medio puede mover y elegir la orientación final del cañón.',
    long: 'Consejo · El Tanque largo dispara únicamente a tres hexágonos exactos.',
    fast: 'Consejo · El Tanque rápido puede avanzar hasta dos hexágonos en línea.',
    drone: 'Consejo · El Dron puede volar y compartir casilla con una unidad terrestre.',
    airplane: 'Consejo · El Avión elige entre volar y disparar; entrar en un escudo lo destruye.',
    antiAir: 'Consejo · El Escudo antiaéreo es inmóvil y protege las seis casillas adyacentes.',
    fortress: 'Consejo · La Fortaleza tiene 2 HP; protégela para evitar la derrota.',
  };
  return hints[piece.type];
}

function renderActionControls(piece: Piece | undefined, legalActions: GameAction[]): void {
  if (mode.kind === 'pieceChoice') {
    actionControls.innerHTML = `<div class="control-section"><h3>Casilla apilada</h3><p>Selecciona capa para inspeccionar.</p><div class="choice-list">${mode.pieceIds
      .map((id) => {
        const candidate = getPiece(state, id);
        return candidate
          ? `<button type="button" data-piece-choice="${id}"><span>${isAirPiece(candidate) ? 'AIRE' : 'SUELO'}</span><strong>${PIECE_NAMES[candidate.type]}</strong></button>`
          : '';
      })
      .join('')}</div></div>`;
    actionControls.querySelectorAll<HTMLButtonElement>('[data-piece-choice]').forEach((button) => {
      button.addEventListener('click', () => selectPiece(button.dataset.pieceChoice ?? ''));
    });
    return;
  }
  if (!piece) {
    actionControls.innerHTML = isMachineTurn()
      ? '<div class="control-section machine-wait"><span class="thinking-pulse" aria-hidden="true"></span><strong>Máquina pensando</strong><p>Ámbar está evaluando sus órdenes.</p></div>'
      : '';
    return;
  }
  if (mode.kind === 'actionChoice') {
    actionControls.innerHTML = `<div class="control-section"><h3>Elegir maniobra</h3><p>Esta casilla admite varias órdenes.</p><div class="choice-list">${mode.actions
      .map((action, index) => targetChoiceMarkup(action, index))
      .join(
        '',
      )}</div><button class="text-button cancel-mode" type="button">Cancelar</button></div>`;
    actionControls.querySelectorAll<HTMLButtonElement>('[data-action-choice]').forEach((button) => {
      button.addEventListener('click', () => {
        const action =
          mode.kind === 'actionChoice'
            ? mode.actions[Number(button.dataset.actionChoice)]
            : undefined;
        if (action) setPending(action);
      });
    });
    actionControls
      .querySelector<HTMLButtonElement>('.cancel-mode')
      ?.addEventListener('click', cancelDraft);
    return;
  }
  if (mode.kind === 'rotate' || mode.kind === 'orient') {
    const current =
      piece.type === 'soldier' ? piece.facing : piece.type === 'medium' ? piece.cannon : null;
    const selectedDirection =
      pendingAction?.kind === 'rotate'
        ? pendingAction.facing
        : pendingAction?.kind === 'orient'
          ? pendingAction.cannon
          : null;
    const title = mode.kind === 'rotate' ? 'Orientar Soldado' : 'Orientar cañón';
    actionControls.innerHTML = directionPanel(title, current, selectedDirection, 'direction-order');
    actionControls
      .querySelectorAll<HTMLButtonElement>('[data-direction-order]')
      .forEach((button) => {
        const direction = Number(button.dataset.directionOrder) as Direction;
        button.addEventListener('click', () => {
          const action = legalActions.find((candidate) =>
            mode.kind === 'rotate'
              ? candidate.kind === 'rotate' && candidate.facing === direction
              : candidate.kind === 'orient' && candidate.cannon === direction,
          );
          if (action) setPending(action);
        });
      });
    actionControls
      .querySelector<HTMLButtonElement>('.cancel-mode')
      ?.addEventListener('click', cancelDraft);
    return;
  }
  if (mode.kind === 'transform') {
    actionControls.innerHTML = `${directionPanel('Abandonar tanque', null, mode.facing, 'transform-facing')}
      <div class="transform-note"><strong>Movimiento opcional</strong><span>Tras elegir orientación, toca uno de los tres destinos frontales o confirma sin mover.</span></div>`;
    actionControls
      .querySelectorAll<HTMLButtonElement>('[data-transform-facing]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const facing = Number(button.dataset.transformFacing) as Direction;
          mode = { kind: 'transform', facing };
          pendingAction =
            legalActions.find(
              (action) =>
                action.kind === 'transform' &&
                action.facing === facing &&
                !action.to &&
                !action.attackAboveId,
            ) ?? null;
          render();
        });
      });
    actionControls
      .querySelector<HTMLButtonElement>('.cancel-mode')
      ?.addEventListener('click', cancelDraft);
    return;
  }

  if (piece.owner !== state.activePlayer || state.outcome) {
    actionControls.innerHTML =
      '<div class="control-section muted-section"><strong>Vista rival</strong><p>Los marcadores atenuados muestran sus desplazamientos y ataques potenciales. No puedes ejecutar esas órdenes.</p></div>';
    return;
  }

  const moveCount = uniqueDestinations(
    legalActions.filter((action) => action.kind === 'move'),
  ).length;
  const attackCount = legalActions.filter(
    (action) =>
      action.kind === 'shoot' ||
      action.kind === 'convert' ||
      action.kind === 'attackAbove' ||
      action.kind === 'attackBelow' ||
      (action.kind === 'move' && Boolean(action.kamikaze)),
  ).length;
  const canRotate = legalActions.some((action) => action.kind === 'rotate');
  const canOrient = legalActions.some((action) => action.kind === 'orient');
  const canTransform = legalActions.some((action) => action.kind === 'transform');
  const above = legalActions.find((action) => action.kind === 'attackAbove');
  const below = legalActions.find((action) => action.kind === 'attackBelow');

  actionControls.innerHTML = `
    <div class="control-section">
      <div class="order-overview">
        <span><strong>${moveCount}</strong> destinos</span>
        <span><strong>${attackCount}</strong> objetivos</span>
      </div>
      <p class="order-hint">Toca un marcador del tablero para preparar la orden.</p>
      <div class="command-buttons">
        ${canRotate ? '<button type="button" data-command="rotate">Girar unidad</button>' : ''}
        ${canOrient ? '<button type="button" data-command="orient">Orientar cañón</button>' : ''}
        ${above ? '<button type="button" data-command="above">Atacar aeronave superior</button>' : ''}
        ${below ? '<button type="button" data-command="below">Atacar unidad inferior</button>' : ''}
        ${canTransform ? '<button type="button" class="danger-command" data-command="transform">Abandonar tanque</button>' : ''}
      </div>
    </div>`;
  actionControls.querySelector('[data-command="rotate"]')?.addEventListener('click', () => {
    mode = { kind: 'rotate' };
    pendingAction = null;
    render();
  });
  actionControls.querySelector('[data-command="orient"]')?.addEventListener('click', () => {
    mode = { kind: 'orient' };
    pendingAction = null;
    render();
  });
  actionControls.querySelector('[data-command="above"]')?.addEventListener('click', () => {
    if (above) setPending(above);
  });
  actionControls.querySelector('[data-command="below"]')?.addEventListener('click', () => {
    if (below) setPending(below);
  });
  actionControls.querySelector('[data-command="transform"]')?.addEventListener('click', () => {
    mode = { kind: 'transform', facing: null };
    pendingAction = null;
    render();
  });
}

function renderPendingCard(piece: Piece | undefined, legalActions: GameAction[]): void {
  const action = pendingAction;
  if (!action) {
    pendingCard.hidden = true;
    pendingCard.innerHTML = '';
    return;
  }
  pendingCard.hidden = false;
  const mediumMove = piece?.type === 'medium' && action.kind === 'move';
  const cannon =
    piece?.type === 'medium' && action.kind === 'move' ? (action.cannon ?? piece.cannon) : null;
  pendingCard.innerHTML = `
    <div class="pending-label"><span>ORDEN PREPARADA</span><i></i></div>
    <strong>${escapeHtml(describeAction(state, action))}</strong>
    ${mediumMove ? `<div class="inline-direction"><span>Cañón tras mover</span>${directionButtons(cannon, 'pending-cannon')}</div>` : ''}
    <div class="pending-actions">
      <button type="button" class="secondary-button cancel-pending">Cancelar</button>
      <button type="button" class="confirm-button" ${animating ? 'disabled' : ''}>Confirmar acción</button>
    </div>`;
  pendingCard
    .querySelector<HTMLButtonElement>('.cancel-pending')
    ?.addEventListener('click', cancelDraft);
  pendingCard
    .querySelector<HTMLButtonElement>('.confirm-button')
    ?.addEventListener('click', () => void commitPending());
  pendingCard.querySelectorAll<HTMLButtonElement>('[data-pending-cannon]').forEach((button) => {
    button.addEventListener('click', () => {
      if (pendingAction?.kind !== 'move') return;
      const direction = Number(button.dataset.pendingCannon) as Direction;
      const replacement = legalActions.find(
        (action) =>
          action.kind === 'move' &&
          equalHex(
            action.to,
            pendingAction && pendingAction.kind === 'move' ? pendingAction.to : action.to,
          ) &&
          action.cannon === direction,
      );
      if (replacement) setPending(replacement);
    });
  });
}

function directionPanel(
  title: string,
  current: Direction | null,
  selected: Direction | null,
  dataName: string,
): string {
  return `<div class="control-section direction-section">
    <h3>${title}</h3>
    <p>Elige un rumbo en la brújula.</p>
    ${directionCompass(current, selected, dataName, false)}
    <button type="button" class="text-button cancel-mode">Volver</button>
  </div>`;
}

function directionButtons(selected: Direction | null, dataName: string): string {
  return directionCompass(null, selected, dataName, true);
}

function directionCompass(
  current: Direction | null,
  selected: Direction | null,
  dataName: string,
  compact: boolean,
): string {
  const highlighted = selected ?? current;
  const centerDirection = highlighted === null ? null : directionNameForView(highlighted);
  const centerLabel =
    selected !== null ? 'SELECCIONADA' : current !== null ? 'ACTUAL' : 'ELIGE RUMBO';
  return `<div class="hex-compass ${compact ? 'compact' : ''}" role="group" aria-label="Brújula de seis direcciones">
    <div class="compass-frame" aria-hidden="true"></div>
    <div class="compass-center" aria-hidden="true"><span>${centerLabel}</span><strong>${centerDirection ?? '·'}</strong></div>
    ${ALL_DIRECTIONS.map((viewDirection) => {
      const direction = modelDirectionForView(viewDirection);
      const isCurrent = current === direction;
      const active = selected === direction;
      const label = DIRECTION_NAMES[viewDirection];
      return `<button type="button" data-${dataName}="${direction}" class="compass-direction ${isCurrent ? 'current' : ''} ${active ? 'active' : ''}" style="--direction:${viewDirection}" ${isCurrent ? 'disabled' : ''} aria-label="${label}${isCurrent ? ', orientación actual' : ''}" aria-pressed="${active || isCurrent}"><i aria-hidden="true">↑</i><span>${label}</span></button>`;
    }).join('')}
  </div>`;
}

function modelDirectionForView(direction: Direction): Direction {
  return ((direction + (viewPlayer() === 0 ? 3 : 0)) % 6) as Direction;
}

function directionNameForView(direction: Direction): string {
  const viewDirection = ((direction + (viewPlayer() === 0 ? 3 : 0)) % 6) as Direction;
  return DIRECTION_NAMES[viewDirection];
}

function viewPlayer(): 0 | 1 {
  return gameMode === 'machine' || preferences.fixedBoard ? 0 : state.activePlayer;
}

function targetChoiceMarkup(action: GameAction, index: number): string {
  const actor = getPiece(state, action.pieceId);
  const targetId =
    action.kind === 'shoot' ||
    action.kind === 'convert' ||
    action.kind === 'attackAbove' ||
    action.kind === 'attackBelow'
      ? action.targetId
      : action.kind === 'transform'
        ? action.attackAboveId
        : undefined;
  const target = targetId ? getPiece(state, targetId) : undefined;
  const destination = actionDestination(state, action);
  const destinationOccupancy = destination ? occupancyAt(state, destination) : undefined;
  if (action.kind === 'move' && action.kamikaze) {
    const victim = destinationOccupancy?.air ?? destinationOccupancy?.ground;
    return `<button type="button" data-action-choice="${index}"><span>KAMIKAZE</span><strong>Destruir ${victim ? PIECE_NAMES[victim.type] : 'objetivo'}</strong></button>`;
  }
  if (actor?.type === 'airplane' && action.kind === 'move' && destinationOccupancy?.ground) {
    return `<button type="button" data-action-choice="${index}"><span>SOBREVUELO</span><strong>Quedar sobre ${PIECE_NAMES[destinationOccupancy.ground.type]}</strong></button>`;
  }
  if (action.kind === 'shoot') {
    return `<button type="button" data-action-choice="${index}"><span>DISPARO</span><strong>Atacar ${target ? PIECE_NAMES[target.type] : 'objetivo'}</strong></button>`;
  }
  const layer = target && isAirPiece(target) ? 'AIRE' : 'SUELO';
  return `<button type="button" data-action-choice="${index}"><span>${layer}</span><strong>${target ? PIECE_NAMES[target.type] : 'Objetivo'}</strong></button>`;
}

function renderBattleLog(): void {
  battleLog.hidden = !logOpen;
  logToggle.setAttribute('aria-expanded', String(logOpen));
  logToggle.textContent = logOpen ? 'Ocultar registro' : 'Registro de batalla';
  battleLog.innerHTML = state.history.length
    ? [...state.history]
        .reverse()
        .map(
          (entry) =>
            `<li class="player-${entry.player === 0 ? 'blue' : 'amber'}"><span>${entry.id}</span><p>${escapeHtml(entry.text)}</p></li>`,
        )
        .join('')
    : '<li class="empty-log">Todavía no hay órdenes ejecutadas.</li>';
}

function renderSoundButton(): void {
  soundButton.classList.toggle('muted', !preferences.sound);
  soundButton.setAttribute('aria-label', preferences.sound ? 'Silenciar sonido' : 'Activar sonido');
  soundButton.setAttribute('aria-pressed', String(!preferences.sound));
  soundButton.title = preferences.sound ? 'Silenciar sonido' : 'Activar sonido';
}

function renderScreenReaderBoard(): void {
  const rows: string[] = [];
  const inspected = selectedId ? getPiece(state, selectedId) : undefined;
  const actionLabel =
    inspected?.owner !== state.activePlayer ? 'Amenazas potenciales' : 'Acciones legales';
  const firingRange = new Set(currentFiringRange().map(hexKey));
  for (let r = -5; r <= 5; r += 1) {
    const cells: string[] = [];
    for (let q = -5; q <= 5; q += 1) {
      const hex = { q, r };
      if (!isOnBoard(hex)) continue;
      const occupancy = occupancyAt(state, hex);
      const pieces = [occupancy.ground, occupancy.air]
        .filter((piece): piece is Piece => Boolean(piece))
        .map((piece) => pieceAccessibleLabel(state, piece, viewPlayer()));
      const legal = [
        ...new Set(
          actionsAtHex(state, visibleActions, hex).map((action) => describeAction(state, action)),
        ),
      ];
      const cellId = accessibleCellId(hex);
      const rangeLabel = firingRange.has(hexKey(hex)) ? '. Alcance potencial de disparo' : '';
      const label = `${pieces.length ? pieces.join('. ') : `Casilla ${q}, ${r}, vacía}`}${rangeLabel}${legal.length ? `. ${actionLabel}: ${legal.join('; ')}` : ''}`;
      cells.push(
        `<div id="${cellId}" role="gridcell" aria-rowindex="${r + 6}" aria-colindex="${q + 6}" aria-selected="${Boolean(focusedHex && equalHex(focusedHex, hex))}" data-hex="${hexKey(hex)}">${escapeHtml(label)}</div>`,
      );
    }
    rows.push(`<div role="row" aria-rowindex="${r + 6}">${cells.join('')}</div>`);
  }
  srBoard.innerHTML = rows.join('');
  if (focusedHex) canvas.setAttribute('aria-activedescendant', accessibleCellId(focusedHex));
  else canvas.removeAttribute('aria-activedescendant');
}

function announceCell(hex: Hex): void {
  const inspected = selectedId ? getPiece(state, selectedId) : undefined;
  const actionLabel =
    inspected?.owner !== state.activePlayer ? 'Amenazas potenciales' : 'Acciones legales';
  const occupancy = occupancyAt(state, hex);
  const pieces = [occupancy.ground, occupancy.air].filter((piece): piece is Piece =>
    Boolean(piece),
  );
  const legal = [
    ...new Set(
      actionsAtHex(state, visibleActions, hex).map((action) => describeAction(state, action)),
    ),
  ];
  const inFiringRange = currentFiringRange().some((cell) => equalHex(cell, hex));
  announce(
    `${
      pieces.length
        ? pieces.map((piece) => pieceAccessibleLabel(state, piece, viewPlayer())).join('. ')
        : `Casilla ${hex.q}, ${hex.r}, vacía.`
    }${inFiringRange ? ' Alcance potencial de disparo.' : ''}${legal.length ? ` ${actionLabel}: ${legal.join('; ')}.` : ''}`,
  );
}

function announce(message: string): void {
  announcer.textContent = '';
  window.setTimeout(() => {
    announcer.textContent = message;
  }, 20);
}

function showNewGameDialog(): void {
  showGameModeDialog(false);
}

function showGameModeDialog(initial: boolean): void {
  const saved = loadActiveMatch();
  const completed = loadAcademyProgress();
  openDialog(`
    <div class="dialog-icon">♟</div>
    <span class="eyebrow">${initial ? 'CENTRO DE MANDO' : 'NUEVA PARTIDA'}</span>
    <h2>Elige tu próxima misión</h2>
    <p>${saved.error ? escapeHtml(`El guardado anterior se descartó: ${saved.error}`) : 'Partida libre siempre está disponible; Academia es opcional.'}</p>
    ${
      saved.record
        ? `<button type="button" class="continue-card" data-continue-match>
            <strong>Continuar partida</strong>
            <small>${saved.record.currentAction} órdenes guardadas · ${escapeHtml(saved.record.config.participants[0].name)} vs ${escapeHtml(saved.record.config.participants[1].name)}</small>
          </button>`
        : ''
    }
    <div class="mode-choice" role="group" aria-label="Modo de juego">
      <button type="button" class="mode-card" data-game-mode="local">
        <span class="mode-icon" aria-hidden="true">♙ ♟</span>
        <strong>Partida libre local</strong>
        <small>Dos jugadores comparten este dispositivo y alternan turnos.</small>
      </button>
      <button type="button" class="mode-card featured" data-game-mode="machine">
        <span class="mode-icon" aria-hidden="true">♙ ⬡</span>
        <strong>Partida libre vs IA</strong>
        <small>Elige entre Recluta, Táctico y Comandante.</small>
      </button>
      <button type="button" class="mode-card academy-card" data-game-mode="academy">
        <span class="mode-icon" aria-hidden="true">◎</span>
        <strong>Academia táctica</strong>
        <small>${completed.length} de ${SCENARIOS.length} desafíos completados.</small>
      </button>
    </div>
    ${initial ? '' : '<div class="dialog-actions"><button type="button" class="secondary-button" data-dialog-close>Cancelar</button></div>'}`);
  dialog.querySelector('[data-continue-match]')?.addEventListener('click', () => {
    if (!saved.record) return;
    loadRecordIntoMatch(saved.record);
    dialog.close();
  });
  dialog.querySelectorAll<HTMLButtonElement>('[data-game-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      gameMode = button.dataset.gameMode as GameMode;
      if (gameMode === 'academy') showAcademyDialog();
      else showFreeMatchConfig(gameMode);
    });
  });
}

function showFreeMatchConfig(modeToConfigure: 'local' | 'machine'): void {
  openDialog(`
    <span class="eyebrow">PARTIDA LIBRE 2.0</span>
    <h2>Configuración clásica</h2>
    <p>El despliegue y las reglas clásicas ya están preparados.</p>
    ${
      modeToConfigure === 'machine'
        ? `<label class="field-row"><span>Dificultad</span><select data-ai-difficulty><option value="recruit">Recluta · ágil</option><option value="tactical">Táctico · anticipa</option><option value="commander">Comandante · profundiza</option></select></label>`
        : ''
    }
    <div class="match-options">
      <span class="eyebrow">OPCIONES DE PARTIDA</span>
      <label class="field-row"><span>Confirmación</span><select data-match-confirmation>
        <option value="always" ${preferences.confirmation === 'always' ? 'selected' : ''}>Siempre</option>
        <option value="critical" ${preferences.confirmation === 'critical' ? 'selected' : ''}>Ataques y acciones críticas</option>
        <option value="quick" ${preferences.confirmation === 'quick' ? 'selected' : ''}>Rápida</option>
      </select></label>
      <div class="match-option-stack">
        <label class="toggle-row"><span><strong>Consejos contextuales</strong><small>Aparecen en la barra sobre el tablero al seleccionar una unidad</small></span><input type="checkbox" data-match-hints ${preferences.contextualHints ? 'checked' : ''}/></label>
        ${
          modeToConfigure === 'local'
            ? `<label class="toggle-row"><span><strong>Pantalla de entrega</strong><small>Oculta el tablero entre turnos</small></span><input type="checkbox" data-match-handoff ${preferences.handoffScreen ? 'checked' : ''}/></label>`
            : ''
        }
      </div>
      <label class="field-row"><span>Reloj opcional</span><select data-match-clock><option value="">Sin reloj</option><option value="300">5 minutos</option><option value="600">10 minutos</option><option value="1200">20 minutos</option></select></label>
    </div>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-back-menu>Volver</button>
      <button type="button" class="confirm-button" data-start-free>Desplegar</button>
    </div>`);
  dialog
    .querySelector('[data-back-menu]')
    ?.addEventListener('click', () => showGameModeDialog(false));
  dialog.querySelector('[data-start-free]')?.addEventListener('click', () => {
    const confirmation = dialog.querySelector<HTMLSelectElement>('[data-match-confirmation]')
      ?.value as GamePreferences['confirmation'];
    preferences.confirmation = confirmation ?? 'always';
    preferences.contextualHints =
      dialog.querySelector<HTMLInputElement>('[data-match-hints]')?.checked ?? true;
    preferences.handoffScreen =
      dialog.querySelector<HTMLInputElement>('[data-match-handoff]')?.checked ?? false;
    savePreferences();
    const clockValue = dialog.querySelector<HTMLSelectElement>('[data-match-clock]')?.value;
    matchConfig = createClassicConfig({
      mode: modeToConfigure,
      difficulty:
        (dialog.querySelector<HTMLSelectElement>('[data-ai-difficulty]')?.value as
          'recruit' | 'tactical' | 'commander') ?? 'recruit',
      confirmation: preferences.confirmation,
      contextualHints: preferences.contextualHints,
      fixedBoard: preferences.fixedBoard,
      handoffScreen: preferences.handoffScreen,
      clockSeconds: clockValue ? Number(clockValue) : null,
    });
    gameMode = modeToConfigure;
    dialog.close();
    resetGame();
  });
}

function showAcademyDialog(): void {
  const completed = new Set(loadAcademyProgress());
  openDialog(`
    <span class="eyebrow">ACADEMIA TÁCTICA</span>
    <h2>Entrenamiento por mecanismos</h2>
    <p>Escenarios cortos que usan exactamente las mismas reglas de Partida libre.</p>
    <div class="scenario-list">
      ${SCENARIOS.map(
        (scenario) => `<button type="button" data-scenario="${scenario.id}">
          <span>${completed.has(scenario.id) ? '✓' : '○'}</span>
          <strong>${escapeHtml(scenario.title)}</strong>
          <small>${escapeHtml(scenario.summary)}</small>
        </button>`,
      ).join('')}
    </div>
    <div class="dialog-actions"><button type="button" class="secondary-button" data-back-menu>Volver</button></div>`);
  dialog
    .querySelector('[data-back-menu]')
    ?.addEventListener('click', () => showGameModeDialog(false));
  dialog.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button) => {
    button.addEventListener('click', () => {
      const scenario = scenarioById(button.dataset.scenario ?? '');
      if (!scenario) return;
      startScenario(scenario);
    });
  });
}

function showHelpDialog(): void {
  openDialog(`
    <span class="eyebrow">MANUAL DE CAMPO</span>
    <h2>${activeScenario ? escapeHtml(activeScenario.title) : 'Destruye la Fortaleza rival'}</h2>
    ${
      activeScenario
        ? `<div class="scenario-hints"><strong>Objetivo</strong><p>${escapeHtml(activeScenario.summary)}</p><ol>${activeScenario.hints.map((hint) => `<li>${escapeHtml(hint)}</li>`).join('')}</ol></div>`
        : ''
    }
    <div class="help-grid">
      <section><strong>1 · Selecciona</strong><p>Elige una unidad propia. Menta indica movimiento, rosa ataque, una mano sobre el objetivo indica conversión y naranja intercepción.</p></section>
      <section><strong>2 · Prepara</strong><p>Toca destino. En casillas apiladas podrás elegir aire o suelo. Revisa consecuencia antes de confirmar.</p></section>
      <section><strong>3 · Confirma</strong><p>Cada turno exige una acción. Girar Soldado y orientar cañón también consumen turno.</p></section>
      <section><strong>Victoria</strong><p>Fortaleza tiene 2 HP. Soldado y Capturador causan 1 HP y se sacrifican; resto causa 2 HP.</p></section>
    </div>
    <details><summary>Reglas tácticas esenciales</summary>
      <p>El Tanque largo dispara a todo el anillo de distancia 3. Drones y Aviones comparten la capa aérea y pueden apilarse sobre una unidad terrestre, pero no atravesarse entre sí.</p>
      <p>El Avión vuela hasta dos casillas por su frente o dispara a su cono ofensivo. Su kamikaze destruye objetivo y Avión. El Escudo antiaéreo es inmóvil: pulveriza aeronaves enemigas y bloquea sus disparos.</p>
      <p>Tanques pueden abandonarse y convertirse permanentemente en Soldados, con movimiento opcional inmediato.</p>
    </details>
    <div class="keyboard-card"><strong>Teclado</strong><span>Q/W/E y A/S/D cubren las seis direcciones · teclado numérico 7/8/9/4/2/6 · Enter selecciona · Esc cancela · H ayuda · L registro · C centra</span></div>
    <p class="game-credits">
      Juego ideado por
      <a href="https://www.instagram.com/roldan_musica" target="_blank" rel="noopener noreferrer">Miquel Roldán Llinàs</a>.
      <span>Programado por <a href="https://lisandrorocha.vercel.app/" target="_blank" rel="noopener noreferrer">Lisandro Rocha Tau</a>.</span>
    </p>
    <div class="dialog-actions"><button type="button" class="confirm-button" data-dialog-close>Entendido</button></div>`);
}

function showSettingsDialog(): void {
  openDialog(`
    <span class="eyebrow">OPCIONES</span>
    <h2>Audio, vista y accesibilidad</h2>
    <p>Personaliza la partida. Los cambios se guardan automáticamente.</p>
    <div class="volume-settings" aria-label="Controles de volumen">
      ${volumeControlMarkup('masterVolume', 'Volumen maestro', 'Controla toda la mezcla', preferences.masterVolume)}
      ${volumeControlMarkup('musicVolume', 'Música', 'Tema ambiental en bucle', preferences.musicVolume)}
      ${volumeControlMarkup('effectsVolume', 'Efectos especiales', 'Movimientos, ataques y avisos', preferences.effectsVolume)}
    </div>
    <div class="board-settings">
      <div><span class="eyebrow">VISTA DEL TABLERO</span><p>Elige si la perspectiva cambia con cada turno.</p></div>
      <label class="toggle-row"><span><strong>Mantener tablero fijo</strong><small>Cian permanece abajo y Ámbar arriba durante toda la partida</small></span><input type="checkbox" data-pref="fixed-board" ${preferences.fixedBoard ? 'checked' : ''}/></label>
      <label class="field-row"><span>Confirmación de órdenes</span><select data-pref="confirmation"><option value="always" ${preferences.confirmation === 'always' ? 'selected' : ''}>Siempre</option><option value="critical" ${preferences.confirmation === 'critical' ? 'selected' : ''}>Solo críticas</option><option value="quick" ${preferences.confirmation === 'quick' ? 'selected' : ''}>Rápida</option></select></label>
      <label class="toggle-row"><span><strong>Consejos contextuales</strong><small>Muestra orientación cuando una mecánica sea relevante</small></span><input type="checkbox" data-pref="hints" ${preferences.contextualHints ? 'checked' : ''}/></label>
      <label class="toggle-row"><span><strong>Pantalla de entrega</strong><small>Oculta la posición entre turnos locales</small></span><input type="checkbox" data-pref="handoff" ${preferences.handoffScreen ? 'checked' : ''}/></label>
    </div>
    <div class="accessibility-settings">
      <div><span class="eyebrow">ACCESIBILIDAD</span><p>Adapta la presentación visual a tus necesidades.</p></div>
      <label class="toggle-row"><span><strong>Alto contraste</strong><small>Refuerza bordes y colores del tablero</small></span><input type="checkbox" data-pref="contrast" ${preferences.highContrast ? 'checked' : ''}/></label>
      <label class="toggle-row"><span><strong>Reducir movimiento</strong><small>Limita animaciones y transiciones</small></span><input type="checkbox" data-pref="motion" ${preferences.reducedMotion ? 'checked' : ''}/></label>
    </div>
    <div class="board-settings">
      <div><span class="eyebrow">DATOS DE PARTIDA</span><p>Las repeticiones se validan antes de cargarse.</p></div>
      <div class="inline-actions">
        <button type="button" class="secondary-button" data-export-match ${matchRecord ? '' : 'disabled'}>Exportar repetición</button>
        <button type="button" class="secondary-button" data-import-match>Importar JSON</button>
        <button type="button" class="text-button" data-open-replay ${matchRecord ? '' : 'disabled'}>Ver historial</button>
        <button type="button" class="text-button" data-undo-match ${matchController?.record.config.options.allowUndo && matchController.record.currentAction > 0 ? '' : 'disabled'}>Deshacer última orden</button>
        <button type="button" class="text-button" data-scenario-editor>Editor de escenarios</button>
      </div>
      <input type="file" accept="application/json,.json" data-import-file hidden/>
    </div>
    <div class="dialog-actions"><button type="button" class="confirm-button" data-dialog-close>Listo</button></div>`);

  dialog.querySelectorAll<HTMLInputElement>('[data-volume]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.volume as 'masterVolume' | 'musicVolume' | 'effectsVolume';
      preferences[key] = Number(input.value) / 100;
      input
        .closest('.volume-control')
        ?.querySelector<HTMLOutputElement>('output')
        ?.replaceChildren(`${input.value}%`);
      audio.setVolumes(
        preferences.masterVolume,
        preferences.musicVolume,
        preferences.effectsVolume,
      );
      audio.startMusic();
      savePreferences();
    });
  });
  dialog
    .querySelector<HTMLInputElement>('[data-pref="fixed-board"]')
    ?.addEventListener('change', (event) => {
      preferences.fixedBoard = (event.currentTarget as HTMLInputElement).checked;
      savePreferences();
      renderer.snapToPlayer(viewPlayer());
      render();
      announce(
        preferences.fixedBoard
          ? 'Tablero fijo. Cian permanece abajo y Ámbar arriba.'
          : `Giro por turnos activado. Vista de ${PLAYER_NAMES[state.activePlayer]}.`,
      );
    });
  dialog
    .querySelector<HTMLInputElement>('[data-pref="contrast"]')
    ?.addEventListener('change', (event) => {
      preferences.highContrast = (event.currentTarget as HTMLInputElement).checked;
      savePreferences();
      applyPreferences();
      render();
    });
  dialog
    .querySelector<HTMLInputElement>('[data-pref="motion"]')
    ?.addEventListener('change', (event) => {
      preferences.reducedMotion = (event.currentTarget as HTMLInputElement).checked;
      savePreferences();
      applyPreferences();
      render();
    });
  dialog
    .querySelector<HTMLSelectElement>('[data-pref="confirmation"]')
    ?.addEventListener('change', (event) => {
      preferences.confirmation = (event.currentTarget as HTMLSelectElement)
        .value as GamePreferences['confirmation'];
      savePreferences();
    });
  for (const [selector, key] of [
    ['[data-pref="hints"]', 'contextualHints'],
    ['[data-pref="handoff"]', 'handoffScreen'],
  ] as const) {
    dialog.querySelector<HTMLInputElement>(selector)?.addEventListener('change', (event) => {
      preferences[key] = (event.currentTarget as HTMLInputElement).checked;
      savePreferences();
    });
  }
  dialog.querySelector('[data-export-match]')?.addEventListener('click', exportCurrentMatch);
  dialog.querySelector('[data-open-replay]')?.addEventListener('click', showReplayDialog);
  dialog.querySelector('[data-undo-match]')?.addEventListener('click', undoLastAction);
  dialog
    .querySelector('[data-scenario-editor]')
    ?.addEventListener('click', showScenarioEditorDialog);
  const importInput = dialog.querySelector<HTMLInputElement>('[data-import-file]');
  dialog
    .querySelector('[data-import-match]')
    ?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (file) void importMatchFile(file);
  });
}

function volumeControlMarkup(
  key: 'masterVolume' | 'musicVolume' | 'effectsVolume',
  label: string,
  description: string,
  value: number,
): string {
  const percentage = Math.round(value * 100);
  return `<label class="volume-control">
    <span><strong>${label}</strong><small>${description}</small></span>
    <input type="range" min="0" max="100" step="1" value="${percentage}" data-volume="${key}" aria-label="${label}"/>
    <output>${percentage}%</output>
  </label>`;
}

function showBlockadeDialog(): void {
  if (state.outcome || animating) return;
  const resultPreview = blockadePreview();
  openDialog(`
    <div class="dialog-icon">≋</div>
    <span class="eyebrow">ACUERDO DE BLOQUEO</span>
    <h2>${PLAYER_NAMES[state.activePlayer]} propone finalizar</h2>
    <p>El rival debe aceptar. Según integridad actual, el resultado será: <strong>${resultPreview}</strong>.</p>
    <p class="dialog-warning">Aceptar no consume turno y finaliza inmediatamente la partida.</p>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-dialog-close>Rechazar</button>
      <button type="button" class="confirm-button" data-accept-blockade>Aceptar como ${PLAYER_NAMES[state.activePlayer === 0 ? 1 : 0]}</button>
    </div>`);
  dialog.querySelector('[data-accept-blockade]')?.addEventListener('click', () => {
    dialog.close();
    void acceptBlockade();
  });
}

async function acceptBlockade(): Promise<void> {
  const before = state;
  const result = declareBlockade(state);
  if (!result.ok) return;
  state = result.state;
  lastEvents = result.events;
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  animating = true;
  audio.playEvents(result.events, before);
  render();
  try {
    await renderer.playEvents(result.events, before, preferences.reducedMotion);
  } finally {
    animating = false;
    render();
  }
  showOutcomeDialog();
}

function blockadePreview(): string {
  const fortresses = state.pieces.filter((piece) => piece.type === 'fortress');
  if (fortresses.every((piece) => piece.type === 'fortress' && piece.hp === 2)) return 'tablas';
  return state.firstFortressDamageBy === null
    ? 'tablas'
    : `victoria de ${PLAYER_NAMES[state.firstFortressDamageBy]}`;
}

function showOutcomeDialog(): void {
  if (!state.outcome) return;
  const winnerClass =
    state.outcome.type === 'win' ? (state.outcome.winner === 0 ? 'blue' : 'amber') : 'draw';
  const remainingBlue = state.pieces.filter((piece) => piece.owner === 0).length;
  const remainingAmber = state.pieces.filter((piece) => piece.owner === 1).length;
  const statistics = matchRecord ? calculateStatistics(matchRecord) : null;
  openDialog(`
    <div class="outcome-seal ${winnerClass}"><i></i></div>
    <span class="eyebrow">BATALLA CONCLUIDA</span>
    <h2>${escapeHtml(outcomeText(state.outcome))}</h2>
    <div class="result-stats">
      <span><strong>${Math.ceil(state.ply / 2)}</strong> turnos</span>
      <span><strong>${remainingBlue}</strong> unidades Cian</span>
      <span><strong>${remainingAmber}</strong> unidades Ámbar</span>
    </div>
    ${
      statistics
        ? `<p class="result-detail">Capturas ${statistics.captures[0]}–${statistics.captures[1]} · Daño a Fortaleza ${statistics.fortressDamage[0]}–${statistics.fortressDamage[1]} · Transformaciones ${statistics.transformations[0]}–${statistics.transformations[1]}</p>`
        : ''
    }
    <div class="dialog-actions triple">
      <button type="button" class="text-button" data-analyze>Analizar partida</button>
      <button type="button" class="secondary-button" data-rematch>Revancha</button>
      <button type="button" class="confirm-button" data-new-game>Nueva partida</button>
    </div>`);
  dialog.querySelectorAll('[data-new-game]').forEach((button) => {
    button.addEventListener('click', () => {
      dialog.close();
      showGameModeDialog(false);
    });
  });
  dialog.querySelector('[data-rematch]')?.addEventListener('click', () => {
    dialog.close();
    resetGame();
  });
  dialog.querySelector('[data-analyze]')?.addEventListener('click', showReplayDialog);
}

function openDialog(markup: string): void {
  closeReplay();
  if (dialog.open) dialog.close();
  dialog.innerHTML = `<div class="dialog-body">${markup}</div>`;
  const heading = dialog.querySelector<HTMLElement>('h2');
  if (heading) {
    heading.id = 'active-dialog-title';
    heading.tabIndex = -1;
    dialog.setAttribute('aria-labelledby', heading.id);
  } else {
    dialog.removeAttribute('aria-labelledby');
  }
  dialog.querySelectorAll('[data-dialog-close]').forEach((button) => {
    button.addEventListener('click', () => dialog.close());
  });
  lockPageScroll();
  dialog.showModal();
  window.setTimeout(() => {
    heading?.focus();
  }, 0);
}

function lockPageScroll(): void {
  document.documentElement.classList.add('modal-open');
}

function unlockPageScroll(): void {
  document.documentElement.classList.remove('modal-open');
}

function resetGame(): void {
  aiAbortController?.abort();
  activeScenario = null;
  matchConfig ??= createClassicConfig({
    mode: gameMode === 'machine' ? 'machine' : 'local',
    confirmation: preferences.confirmation,
    contextualHints: preferences.contextualHints,
    fixedBoard: preferences.fixedBoard,
    handoffScreen: preferences.handoffScreen,
  });
  matchRecord = createMatchRecord(matchConfig);
  matchController = new MatchController(matchRecord);
  state = replayRecord(matchRecord);
  clearActiveMatch();
  saveActiveMatch(matchRecord);
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  lastEvents = [];
  focusedHex = { q: 0, r: 0 };
  renderer.resetView();
  renderer.snapToPlayer(viewPlayer());
  renderedStatusKey = '';
  machineThinking = false;
  render();
  announce(
    gameMode === 'machine'
      ? 'Nueva partida contra la máquina. Juegas como Cian.'
      : 'Nueva partida para dos personas. Turno de Cian.',
  );
  showToast(
    gameMode === 'machine'
      ? 'Modo contra la máquina. Tú controlas a Cian.'
      : 'Modo para dos personas. Cian inicia.',
  );
}

function startScenario(scenario: ScenarioDefinition): void {
  aiAbortController?.abort();
  activeScenario = scenario;
  gameMode = 'academy';
  matchConfig = createClassicConfig({
    mode: 'local',
    confirmation: preferences.confirmation,
    contextualHints: true,
    fixedBoard: true,
    handoffScreen: false,
  });
  matchConfig = {
    ...matchConfig,
    definitionId: `scenario:${scenario.id}`,
    setup: scenario.initialState.pieces.map((piece) => ({ id: piece.id, piece })),
    options: { ...matchConfig.options, allowUndo: true },
  };
  matchRecord = createMatchRecord(matchConfig, scenario.initialState);
  matchController = new MatchController(matchRecord);
  state = replayRecord(matchRecord);
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  lastEvents = [];
  focusedHex = { q: 0, r: 0 };
  renderer.resetView();
  renderer.snapToPlayer(0);
  renderedStatusKey = '';
  render();
  announce(`${scenario.title}. ${scenario.summary}`);
  showScenarioBriefing(scenario);
}

function loadRecordIntoMatch(record: MatchRecord): void {
  aiAbortController?.abort();
  activeScenario = record.config.definitionId.startsWith('scenario:')
    ? (scenarioById(record.config.definitionId.slice('scenario:'.length)) ?? null)
    : null;
  matchRecord = record;
  matchController = new MatchController(record);
  matchConfig = record.config;
  gameMode = activeScenario
    ? 'academy'
    : record.config.participants[1].kind === 'machine'
      ? 'machine'
      : 'local';
  state = replayForDisplay(record);
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  lastEvents = [];
  renderer.resetView();
  renderer.snapToPlayer(viewPlayer());
  renderedStatusKey = '';
  render();
  showToast(`Partida recuperada en la orden ${record.currentAction}.`);
  if (isMachineTurn()) void runMachineTurn();
}

function showScenarioSuccess(scenario: ScenarioDefinition): void {
  openDialog(`
    <div class="dialog-icon">✓</div>
    <span class="eyebrow">OBJETIVO COMPLETADO</span>
    <h2>${escapeHtml(scenario.title)}</h2>
    <p>${escapeHtml(scenario.successText)}</p>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-retry-scenario>Repetir</button>
      <button type="button" class="confirm-button" data-academy-menu>Siguiente desafío</button>
    </div>`);
  dialog.querySelector('[data-retry-scenario]')?.addEventListener('click', () => {
    startScenario(scenario);
  });
  dialog.querySelector('[data-academy-menu]')?.addEventListener('click', showAcademyDialog);
}

function showScenarioBriefing(scenario: ScenarioDefinition): void {
  openDialog(`
    <span class="eyebrow">INSTRUCCIÓN TÁCTICA</span>
    <h2>${escapeHtml(scenario.title)}</h2>
    <p class="scenario-objective"><strong>Objetivo:</strong> ${escapeHtml(scenario.summary)}</p>
    <ol class="scenario-steps">
      ${scenario.hints.map((hint) => `<li>${escapeHtml(hint)}</li>`).join('')}
    </ol>
    <p class="dialog-note">El objetivo y el siguiente paso seguirán visibles en la barra superior del tablero. También puedes abrir Ayuda en cualquier momento.</p>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-academy-menu>Volver</button>
      <button type="button" class="confirm-button" data-dialog-close>Empezar ejercicio</button>
    </div>`);
  dialog.querySelector('[data-academy-menu]')?.addEventListener('click', showAcademyDialog);
}

function showScenarioRetry(scenario: ScenarioDefinition): void {
  openDialog(`
    <span class="eyebrow">REVISIÓN DEL EJERCICIO</span>
    <h2>Esta orden no completa el objetivo</h2>
    <p>${escapeHtml(scenario.summary)}</p>
    <ol class="scenario-steps">
      ${scenario.hints.map((hint) => `<li>${escapeHtml(hint)}</li>`).join('')}
    </ol>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-academy-menu>Elegir otro</button>
      <button type="button" class="confirm-button" data-retry-scenario>Reintentar</button>
    </div>`);
  dialog.querySelector('[data-academy-menu]')?.addEventListener('click', showAcademyDialog);
  dialog.querySelector('[data-retry-scenario]')?.addEventListener('click', () => {
    startScenario(scenario);
  });
}

function showHandoffDialog(): void {
  openDialog(`
    <div class="dialog-icon">↻</div>
    <span class="eyebrow">CAMBIO DE MANDO</span>
    <h2>Entrega el dispositivo</h2>
    <p>Turno de <strong>${escapeHtml(matchConfig?.participants[state.activePlayer].name ?? PLAYER_NAMES[state.activePlayer])}</strong>. La posición queda oculta hasta continuar.</p>
    <div class="dialog-actions"><button type="button" class="confirm-button" data-handoff-ready>Estoy listo</button></div>`);
  dialog.querySelector('[data-handoff-ready]')?.addEventListener('click', () => dialog.close());
}

function showReplayDialog(): void {
  if (!matchRecord) return;
  if (dialog.open) dialog.close();
  closeReplay();
  const record = matchRecord;
  const boardStage = document.querySelector<HTMLElement>('.board-stage');
  if (!boardStage) return;
  replayDock = document.createElement('section');
  replayDock.className = 'replay-dock';
  replayDock.setAttribute('aria-label', 'Controles de análisis de partida');
  replayDock.innerHTML = `
    <div class="replay-heading">
      <div><span class="eyebrow">ANÁLISIS</span><strong>Posición <output data-replay-output>${record.currentAction}</output> de ${record.actions.length}</strong></div>
      <button type="button" class="icon-button replay-close" data-replay-close aria-label="Cerrar análisis">×</button>
    </div>
    <p class="replay-description" data-replay-description></p>
    <div class="replay-controls">
      <button type="button" class="secondary-button" data-replay-step="-1" aria-label="Posición anterior">←</button>
      <input type="range" min="0" max="${record.actions.length}" value="${record.currentAction}" data-replay-slider aria-label="Posición de la repetición"/>
      <button type="button" class="secondary-button" data-replay-step="1" aria-label="Posición siguiente">→</button>
    </div>
    <button type="button" class="text-button replay-export" data-export-match>Exportar JSON</button>`;
  boardStage.append(replayDock);
  const slider = replayDock.querySelector<HTMLInputElement>('[data-replay-slider]');
  const updateReplay = (value: number): void => {
    const cursor = Math.max(0, Math.min(record.actions.length, value));
    state = replayForDisplay(record, cursor);
    slider!.value = String(cursor);
    replayDock!.querySelector<HTMLOutputElement>('[data-replay-output]')!.value = String(cursor);
    const description = replayDock!.querySelector<HTMLElement>('[data-replay-description]');
    if (description) {
      description.textContent =
        cursor === 0
          ? 'Posición inicial'
          : describeAction(replayForDisplay(record, cursor - 1), record.actions[cursor - 1]);
    }
    selectedId = null;
    pendingAction = null;
    render();
  };
  slider?.addEventListener('input', () => updateReplay(Number(slider.value)));
  replayDock.querySelectorAll<HTMLButtonElement>('[data-replay-step]').forEach((button) => {
    button.addEventListener('click', () =>
      updateReplay(
        Number(slider?.value ?? record.currentAction) + Number(button.dataset.replayStep),
      ),
    );
  });
  replayDock.querySelector('[data-export-match]')?.addEventListener('click', exportCurrentMatch);
  replayDock.querySelector('[data-replay-close]')?.addEventListener('click', () => closeReplay());
  updateReplay(record.currentAction);
  announce('Modo análisis abierto. El tablero permanece visible.');
}

function closeReplay(): void {
  if (!replayDock) return;
  if (matchRecord) state = replayForDisplay(matchRecord);
  replayDock.remove();
  replayDock = null;
  renderedStatusKey = '';
  render();
}

function replayForDisplay(
  record: MatchRecord,
  actionCount = record.currentAction,
): ReturnType<typeof replayRecord> {
  const replayed = replayRecord(record, actionCount);
  return record.config.definitionId.startsWith('scenario:')
    ? { ...replayed, outcome: null }
    : replayed;
}

function undoLastAction(): void {
  aiAbortController?.abort();
  aiStrategy.dispose();
  aiAbortController = null;
  machineThinking = false;

  if (!matchController?.undo()) {
    showToast('Deshacer no está permitido en este modo.');
    return;
  }

  // In a solo match, return to the human's previous decision instead of
  // leaving the restored position on the machine's turn.
  if (gameMode === 'machine' && matchController.store.getState().game.activePlayer === 1) {
    matchController.undo();
  }

  matchRecord = matchController.record;
  state = matchController.store.getState().game;
  saveActiveMatch(matchRecord);
  selectedId = null;
  pendingAction = null;
  lastEvents = [];
  renderedStatusKey = '';
  dialog.close();
  render();
  announce('Última orden deshecha.');
}

function exportCurrentMatch(): void {
  if (!matchRecord) return;
  const blob = new Blob([serializeRecord(matchRecord)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `protocolo-hexagonal-${matchRecord.config.definitionId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importMatchFile(file: File): Promise<void> {
  try {
    const record = parseRecord(await file.text());
    saveActiveMatch(record);
    loadRecordIntoMatch(record);
    dialog.close();
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'No se pudo importar la partida.');
  }
}

function showScenarioEditorDialog(): void {
  const baseConfig =
    matchConfig ??
    createClassicConfig({
      mode: 'local',
      confirmation: preferences.confirmation,
      fixedBoard: true,
    });
  const template: CustomScenario = {
    version: 1,
    id: `custom-${Date.now()}`,
    title: 'Escenario personalizado',
    config: {
      ...baseConfig,
      definitionId: `custom-${Date.now()}`,
      setup: state.pieces.map((piece) => ({ id: piece.id, piece })),
    },
    initialState: state,
  };
  const catalog = loadScenarioCatalog();
  openDialog(`
    <span class="eyebrow">LABORATORIO</span>
    <h2>Editor de escenarios</h2>
    <p>Edita la posición como JSON. Al guardar se comprueban tablero, capas, Fortalezas, identificadores y ruleset.</p>
    <textarea class="scenario-editor" data-scenario-json spellcheck="false">${escapeHtml(JSON.stringify(template, null, 2))}</textarea>
    ${
      catalog.length
        ? `<label class="field-row"><span>Catálogo local</span><select data-catalog-choice><option value="">Seleccionar…</option>${catalog.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.title)}</option>`).join('')}</select></label>`
        : '<p class="muted-copy">El catálogo local está vacío.</p>'
    }
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-dialog-close>Cancelar</button>
      <button type="button" class="confirm-button" data-save-scenario>Validar y jugar</button>
    </div>`);
  const editor = dialog.querySelector<HTMLTextAreaElement>('[data-scenario-json]');
  dialog
    .querySelector<HTMLSelectElement>('[data-catalog-choice]')
    ?.addEventListener('change', (event) => {
      const selected = catalog.find(
        (entry) => entry.id === (event.currentTarget as HTMLSelectElement).value,
      );
      if (selected && editor) editor.value = JSON.stringify(selected, null, 2);
    });
  dialog.querySelector('[data-save-scenario]')?.addEventListener('click', () => {
    try {
      const scenario = validateCustomScenario(JSON.parse(editor?.value ?? '') as CustomScenario);
      saveCustomScenario(scenario);
      const record = createMatchRecord(scenario.config, scenario.initialState);
      saveActiveMatch(record);
      loadRecordIntoMatch(record);
      dialog.close();
      showToast(`Escenario “${scenario.title}” guardado en el catálogo.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'El escenario no es válido.');
    }
  });
}

function showToast(message: string): void {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => toast.classList.add('visible'), 10);
  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), 220);
  }, 2600);
}

function applyPreferences(): void {
  document.documentElement.classList.toggle('high-contrast', preferences.highContrast);
  document.documentElement.classList.toggle('reduced-motion', preferences.reducedMotion);
}

function savePreferences(): void {
  persistPreferences(preferences);
}

function accessibleCellId(hex: Hex): string {
  return `hex-cell-${hex.q + 5}-${hex.r + 5}`;
}

function uniqueDestinations(actions: GameAction[]): string[] {
  const keys = new Set<string>();
  for (const action of actions) {
    if (action.kind === 'move') keys.add(hexKey(action.to));
  }
  return [...keys];
}

function pieceMonogram(piece: Piece): string {
  return {
    soldier: 'S',
    capturer: 'C',
    medium: 'M2',
    long: 'L3',
    fast: 'R',
    drone: 'D',
    airplane: 'A',
    antiAir: 'AA',
    fortress: 'F',
  }[piece.type];
}

function pieceDescription(piece: Piece): string {
  return {
    soldier: 'Avanza una casilla en su arco frontal. Puede girar como acción exclusiva.',
    capturer:
      'Convierte una unidad rival adyacente sin desplazarse. Capturadores aliados protegen.',
    medium: 'Mueve una casilla o dispara a distancia 2 en el arco del cañón.',
    long: 'Mueve una casilla o dispara exactamente a distancia 3 en cualquier dirección.',
    fast: 'Recorre una línea libre sin límite y captura ocupando el destino.',
    drone: 'Vuela hasta tres casillas, sobrevuela suelo y puede compartir hexágono.',
    airplane:
      'Vuela hasta dos casillas por su arco frontal o dispara al cono ofensivo. Puede atacar en kamikaze.',
    antiAir: 'Escudo inmóvil: protege siete hexágonos, pulveriza aeronaves y bloquea disparos.',
    fortress: 'Objetivo estratégico inmóvil. Su destrucción termina la partida.',
  }[piece.type];
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character] ?? character,
  );
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento #${id}`);
  return element as T;
}
