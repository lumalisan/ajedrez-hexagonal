import './styles.css';

import { chooseMachineAction } from './ai';
import type { SearchMetadata } from './ai';
import { WorkerAiStrategy, difficultyBudget } from './ai-strategy';
import { analyzeActionConsequences, consequenceTone } from './action-consequences';
import { AudioDirector } from './audio';
import { CLASSIC_RULES_NOTE, fortressAttackSummary } from './classic-rules';
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
  resolutionRulesForConfig,
  serializeRecord,
  setAcademySession,
} from './match-record';
import { MatchController } from './match-controller';
import { analyzeMatchMoments } from './match-insights';
import { MATCH_PRESETS, createPresetConfig, type MatchPresetId } from './match-presets';
import {
  appendMatchHistory,
  clearActiveMatch,
  loadAcademyRecords,
  loadAcademyProgress,
  loadActiveMatch,
  loadMatchHistory,
  loadPreferences,
  recordScenarioAttempt,
  resetAcademyProgress,
  saveActiveMatch,
  savePreferences as persistPreferences,
  type AcademyRecord,
} from './match-storage';
import {
  clearTelemetry,
  loadTelemetry,
  recordTelemetry,
  serializeTelemetry,
  telemetrySummary,
} from './playtest-telemetry';
import { BoardRenderer, actionsAtHex, pieceAccessibleLabel, type RenderModel } from './renderer';
import { analyzeImmediateThreats } from './tactical-analysis';
import {
  SCENARIOS,
  dailyScenarioForDate,
  evaluateScenarioProgress,
  nextScenarioHint,
  revealedScenarioHints,
  scenarioById,
  scenarioLessonAt,
  scenariosByCategory,
  type ScenarioProgress,
} from './scenarios';
import {
  loadScenarioCatalog,
  saveCustomScenario,
  validateCustomScenario,
  type CustomScenario,
} from './scenario-catalog';
import { mountRuleDemo } from './rules-demo';
import { RULE_SECTIONS, type RuleParagraph, type RuleSection } from './rules-content';
import { captureAboveCommandLabel } from './ui-copy';
import type {
  AiDifficulty,
  AiPersonality,
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
  ScenarioObjective,
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

interface CommandSheetDragState {
  pointerId: number;
  startY: number;
  startTranslateY: number;
  maxTranslateY: number;
  currentTranslateY: number;
  moved: boolean;
}

const canvas = requireElement<HTMLCanvasElement>('game-canvas');
const app = requireElement<HTMLElement>('app');
const homeScreen = requireElement<HTMLElement>('home-screen');
const homeMenuContent = requireElement<HTMLElement>('home-menu-content');
const topbar = requireElementBySelector<HTMLElement>('.topbar');
const gameLayout = requireElementBySelector<HTMLElement>('.game-layout');
const commandPanel = requireElement<HTMLElement>('command-panel');
const commandSheetToggle = requireElement<HTMLButtonElement>('command-sheet-toggle');
const renderer = new BoardRenderer(canvas);
const preferences = loadPreferences();
renderer.setDepthMode(preferences.boardDepth, true);
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
let replayClockWasRunning = false;
let replayFocusReturn: HTMLElement | null = null;
let machineThinking = false;
let machineSearch: SearchMetadata | null = null;
let logOpen = false;
let renderedStatusKey = '';
let homeDemoTimer: number | null = null;
let homeDemoBusy = false;
let scenarioProgress: ScenarioProgress | null = null;
let scenarioHintsRevealed = 0;
let scenarioAttemptsRecorded = false;
let outcomePresentedFor = '';
let commandSheetExpanded = false;
let commandSheetDrag: CommandSheetDragState | null = null;
let suppressCommandSheetClick = false;
let lastClockPersistSecond = -1;

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
const homeSoundButton = requireElement<HTMLButtonElement>('home-sound-button');
const homeSettingsButton = requireElement<HTMLButtonElement>('home-settings-button');
const blockadeButton = requireElement<HTMLButtonElement>('blockade-button');
const mobileNewGameButton = requireElement<HTMLButtonElement>('mobile-new-game-button');
const threatToggle = requireElement<HTMLButtonElement>('threat-toggle');
const dialog = requireElement<HTMLDialogElement>('game-dialog');
const toastRegion = requireElement<HTMLElement>('toast-region');
const announcer = requireElement<HTMLElement>('announcer');
const srBoard = requireElement<HTMLElement>('sr-board');
const matchClockDisplay = document.getElementById('match-clock');

applyPreferences();
bindControls();
showHomeScreen();
window.setInterval(tickActiveClock, 250);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}

function bindControls(): void {
  homeMenuContent.addEventListener('click', onHomeMenuClick);
  bindCommandSheetControls();
  threatToggle.addEventListener('click', () => {
    preferences.tacticalThreats = !preferences.tacticalThreats;
    savePreferences();
    render();
    const count = preferences.tacticalThreats
      ? analyzeImmediateThreats(state).threatenedPieceIds.length
      : 0;
    announce(
      preferences.tacticalThreats
        ? `Amenazas inmediatas visibles. ${count} ${count === 1 ? 'unidad amenazada' : 'unidades amenazadas'}.`
        : 'Amenazas inmediatas ocultas.',
    );
  });
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
  homeSettingsButton.addEventListener('click', showSettingsDialog);
  blockadeButton.addEventListener('click', showBlockadeDialog);

  for (const button of [soundButton, homeSoundButton]) {
    button.addEventListener('click', () => {
      preferences.sound = audio.toggle();
      savePreferences();
      renderSoundButton();
    });
  }

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
    if (event.target === dialog && dialog.dataset.mandatory !== 'true') dialog.close();
  });
  dialog.addEventListener('cancel', (event) => {
    if (dialog.dataset.mandatory === 'true') event.preventDefault();
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
  if (window.innerWidth <= 760) commandSheetExpanded = false;
  render();
}

function cancelDraft(): void {
  if (pendingAction) {
    recordTelemetry('action-cancelled', {
      kind: pendingAction.kind,
      ply: state.ply,
      mode: gameMode ?? 'none',
    });
  }
  pendingAction = null;
  mode = { kind: 'default' };
  render();
  announce('Orden cancelada.');
}

function setPending(action: GameAction): void {
  pendingAction = action;
  if (window.innerWidth <= 760) commandSheetExpanded = true;
  recordTelemetry('action-prepared', {
    kind: action.kind,
    ply: state.ply,
    mode: gameMode ?? 'none',
  });
  if (mode.kind === 'actionChoice') mode = { kind: 'default' };
  render();
  if (window.innerWidth <= 760) commandPanel.scrollTop = 0;
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
  if (matchController?.record.clock && !state.outcome) {
    matchController.tickClock(Date.now());
    matchRecord = matchController.record;
    state = matchController.store.getState().game;
    if (state.outcome) {
      persistCurrentMatch();
      render();
      presentOutcome();
      return;
    }
  }
  const before = state;
  const result = matchController ? matchController.commit(action) : applyAction(state, action);
  if (!result.ok) {
    audio.playInvalid();
    showToast(result.error ?? 'Orden rechazada.');
    return;
  }

  state = result.state;
  scenarioProgress = activeScenario
    ? evaluateScenarioProgress(activeScenario, before, state, action)
    : null;
  if (activeScenario) state = { ...state, outcome: null };
  if (matchController) {
    if (matchController.record.clock) matchController.pauseClock(Date.now());
    matchRecord = matchController.record;
  } else if (matchRecord) matchRecord = appendAction(matchRecord, action);
  persistCurrentMatch();
  recordTelemetry('action-committed', {
    kind: action.kind,
    ply: state.ply,
    mode: gameMode ?? 'none',
    events: result.events.length,
  });
  lastEvents = activeScenario
    ? result.events.filter((event) => event.type !== 'draw' && event.type !== 'victory')
    : result.events;
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  if (window.innerWidth <= 760) commandSheetExpanded = false;
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

  if (activeScenario && scenarioProgress?.status === 'success') {
    recordActiveScenarioAttempt(true);
    showScenarioSuccess(activeScenario);
  } else if (activeScenario && scenarioProgress?.status === 'failure') {
    recordActiveScenarioAttempt(false);
    showScenarioRetry(activeScenario, scenarioProgress.feedback);
  } else if (activeScenario) {
    announce(scenarioProgress?.feedback ?? scenarioLessonAt(activeScenario, state.ply));
    if (scenarioProgress?.feedback) showToast(scenarioProgress.feedback);
    startActiveTurnClock();
    if (isMachineTurn()) void runMachineTurn();
  } else if (state.outcome) {
    presentOutcome();
  } else {
    audio.playTurn();
    const passedPlayer = result.events.find((event) => event.type === 'pass')?.owner;
    if (passedPlayer !== undefined) {
      const message = `${PLAYER_NAMES[passedPlayer]} no tiene acciones legales y pasa. Turno de ${PLAYER_NAMES[state.activePlayer]}.`;
      showToast(message);
      announce(message);
    } else announce(`Turno de ${PLAYER_NAMES[state.activePlayer]}.`);
    if (gameMode === 'local' && preferences.handoffScreen) showHandoffDialog();
    else {
      startActiveTurnClock();
      if (isMachineTurn()) void runMachineTurn();
    }
  }
}

async function runMachineTurn(): Promise<void> {
  if (!isMachineTurn() || state.outcome || animating) return;
  machineThinking = true;
  machineSearch = null;
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  render();
  announce('Turno de la máquina. Pensando jugada.');
  await new Promise<void>((resolve) =>
    window.setTimeout(resolve, preferences.reducedMotion ? 60 : 220),
  );
  if (!isMachineTurn() || state.outcome) {
    machineThinking = false;
    render();
    return;
  }
  aiAbortController?.abort();
  aiAbortController = new AbortController();
  const participant = matchConfig?.participants[state.activePlayer];
  const difficulty = participant?.difficulty ?? 'recruit';
  const action = matchConfig
    ? await aiStrategy.chooseAction(state, matchConfig, {
        maxMs: difficultyBudget(difficulty, window.innerWidth < 700),
        signal: aiAbortController.signal,
        onProgress: (metadata) => {
          machineSearch = { ...metadata };
          renderedStatusKey = '';
          render();
        },
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
  if (gameMode === 'academy' && activeScenario) {
    return state.activePlayer !== activeScenario.controlledPlayer;
  }
  return gameMode === 'machine' && matchConfig?.participants[state.activePlayer].kind === 'machine';
}

function persistCurrentMatch(): void {
  if (!matchRecord) return;
  try {
    if (!saveActiveMatch(matchRecord))
      showToast('No se pudo guardar la partida en este navegador.');
  } catch {
    showToast('No se pudo guardar la partida en este navegador.');
  }
}

function startActiveTurnClock(): void {
  if (!matchController?.record.clock || state.outcome || replayDock || isHomeScreenActive()) return;
  const now = Date.now();
  matchController.switchClock(state.activePlayer, now);
  matchController.resumeClock(now);
  matchRecord = matchController.record;
  state = matchController.store.getState().game;
  persistCurrentMatch();
  renderClockDisplay();
}

function tickActiveClock(): void {
  if (!matchController?.record.clock || isHomeScreenActive() || state.outcome || replayDock) return;
  const clock = matchController.tickClock(Date.now());
  if (!clock) return;
  matchRecord = matchController.record;
  state = matchController.store.getState().game;
  const currentSecond = Math.ceil(clock.remainingMs[clock.activePlayer] / 1_000);
  if (currentSecond !== lastClockPersistSecond || state.outcome) {
    lastClockPersistSecond = currentSecond;
    persistCurrentMatch();
  }
  renderClockDisplay();
  if (state.outcome) {
    renderedStatusKey = '';
    render();
    presentOutcome();
  }
}

function presentOutcome(): void {
  if (!state.outcome || !matchRecord) return;
  const key = `${matchRecord.createdAt}:${state.outcome.type}:${state.outcome.reason}`;
  if (outcomePresentedFor === key) return;
  if (matchController?.record.clock) {
    matchController.pauseClock(Date.now());
    matchRecord = matchController.record;
  }
  persistCurrentMatch();
  const completedAt = new Date().toISOString();
  appendMatchHistory({
    id: matchRecord.createdAt,
    definitionId: matchRecord.config.definitionId,
    participants: [
      matchRecord.config.participants[0].name,
      matchRecord.config.participants[1].name,
    ],
    outcome: state.outcome,
    plies: matchRecord.currentAction,
    durationSeconds: Math.max(
      0,
      Math.round((Date.parse(completedAt) - Date.parse(matchRecord.createdAt)) / 1_000),
    ),
    completedAt,
  });
  clearActiveMatch();
  recordTelemetry('match-finished', {
    mode: gameMode ?? 'none',
    plies: matchRecord.currentAction,
    result: `${state.outcome.type}:${state.outcome.reason}`,
  });
  outcomePresentedFor = key;
  if (!preferences.reducedMotion) {
    navigator.vibrate?.([60, 40, 120]);
    document.body.classList.add('match-climax');
    window.setTimeout(() => document.body.classList.remove('match-climax'), 1_400);
  }
  announce(outcomeText(state.outcome));
  showOutcomeDialog();
}

function recordActiveScenarioAttempt(completed: boolean): void {
  if (!activeScenario || scenarioAttemptsRecorded) return;
  const elapsed = Math.max(0, state.ply - activeScenario.initialState.ply);
  recordScenarioAttempt(activeScenario.id, {
    completed,
    plies: elapsed,
    hintsUsed: scenarioHintsRevealed,
    parPlies: activeScenario.maxPlies,
  });
  recordTelemetry('academy-finished', {
    scenario: activeScenario.id,
    completed,
    plies: elapsed,
    hints: scenarioHintsRevealed,
  });
  clearActiveMatch();
  scenarioAttemptsRecorded = true;
}

function renderCommandSheetState(): void {
  const expanded = commandSheetExpanded || Boolean(pendingAction) || mode.kind !== 'default';
  document.body.classList.toggle('command-sheet-expanded', expanded);
  document.body.classList.toggle('command-sheet-collapsed', !expanded);
  document.body.classList.toggle('command-sheet-pending', Boolean(pendingAction));
  commandSheetToggle.setAttribute('aria-expanded', String(expanded));
  commandSheetToggle.setAttribute(
    'aria-label',
    expanded ? 'Contraer panel de mando' : 'Abrir panel de mando',
  );
}

function bindCommandSheetControls(): void {
  commandSheetToggle.addEventListener('click', (event) => {
    if (suppressCommandSheetClick) {
      event.preventDefault();
      suppressCommandSheetClick = false;
      return;
    }
    commandSheetExpanded = !commandSheetExpanded;
    renderCommandSheetState();
  });
  commandSheetToggle.addEventListener('pointerdown', onCommandSheetPointerDown);
  commandSheetToggle.addEventListener('pointermove', onCommandSheetPointerMove);
  commandSheetToggle.addEventListener('pointerup', onCommandSheetPointerUp);
  commandSheetToggle.addEventListener('pointercancel', onCommandSheetPointerCancel);
}

function onCommandSheetPointerDown(event: PointerEvent): void {
  if (window.innerWidth > 760 || !event.isPrimary || event.button !== 0) return;
  const maxTranslateY = commandSheetMaxTranslate();
  commandSheetDrag = {
    pointerId: event.pointerId,
    startY: event.clientY,
    startTranslateY: commandSheetTranslateY(),
    maxTranslateY,
    currentTranslateY: commandSheetTranslateY(),
    moved: false,
  };
  commandSheetToggle.setPointerCapture(event.pointerId);
  document.body.classList.add('command-sheet-dragging');
}

function onCommandSheetPointerMove(event: PointerEvent): void {
  if (!commandSheetDrag || commandSheetDrag.pointerId !== event.pointerId) return;
  const deltaY = event.clientY - commandSheetDrag.startY;
  if (Math.abs(deltaY) > 5) commandSheetDrag.moved = true;
  commandSheetDrag.currentTranslateY = Math.max(
    0,
    Math.min(commandSheetDrag.maxTranslateY, commandSheetDrag.startTranslateY + deltaY),
  );
  commandPanel.style.transform = `translateY(${commandSheetDrag.currentTranslateY}px)`;
  if (commandSheetDrag.moved) event.preventDefault();
}

function onCommandSheetPointerUp(event: PointerEvent): void {
  if (!commandSheetDrag || commandSheetDrag.pointerId !== event.pointerId) return;
  const drag = commandSheetDrag;
  const deltaY = event.clientY - drag.startY;
  if (drag.moved) {
    commandSheetExpanded =
      Math.abs(deltaY) >= 28 ? deltaY < 0 : drag.currentTranslateY < drag.maxTranslateY / 2;
    suppressCommandSheetClick = true;
    window.setTimeout(() => {
      suppressCommandSheetClick = false;
    }, 0);
  }
  finishCommandSheetDrag();
}

function onCommandSheetPointerCancel(event: PointerEvent): void {
  if (!commandSheetDrag || commandSheetDrag.pointerId !== event.pointerId) return;
  finishCommandSheetDrag();
}

function finishCommandSheetDrag(): void {
  if (commandSheetDrag && commandSheetToggle.hasPointerCapture(commandSheetDrag.pointerId)) {
    commandSheetToggle.releasePointerCapture(commandSheetDrag.pointerId);
  }
  commandSheetDrag = null;
  commandPanel.style.removeProperty('transform');
  document.body.classList.remove('command-sheet-dragging');
  renderCommandSheetState();
}

function commandSheetTranslateY(): number {
  const transform = getComputedStyle(commandPanel).transform;
  if (transform === 'none') return 0;
  return new DOMMatrixReadOnly(transform).m42;
}

function commandSheetMaxTranslate(): number {
  const rootStyles = getComputedStyle(document.documentElement);
  const panelStyles = getComputedStyle(commandPanel);
  const peek = Number.parseFloat(rootStyles.getPropertyValue('--command-sheet-peek')) || 66;
  const safeArea = Math.max(0, (Number.parseFloat(panelStyles.paddingBottom) || 14) - 14);
  return Math.max(0, commandPanel.getBoundingClientRect().height - peek - safeArea);
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
  renderThreatToggle();
  renderCommandSheetState();
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
  const tacticalAnalysis = preferences.tacticalThreats ? analyzeImmediateThreats(state) : null;
  const model: RenderModel = {
    state,
    fortressMaxHp: [fortressMaximumHp(0), fortressMaximumHp(1)],
    selectedId,
    actions: visibleActions,
    pending: pendingAction,
    hovered: hoveredHex,
    focused: focusedHex,
    firingRange: currentFiringRange(),
    lastEvents,
    threatenedCells: tacticalAnalysis?.threatenedCells ?? [],
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
  blockadeButton.disabled =
    Boolean(state.outcome) || animating || gameMode === 'machine' || Boolean(activeScenario);
  blockadeButton.hidden = gameMode === 'machine' || Boolean(activeScenario);
  renderClockDisplay();
  const fortressState = state.pieces
    .filter((piece) => piece.type === 'fortress')
    .map((piece) => `${piece.owner}:${piece.hp}`)
    .sort()
    .join('|');
  const criticalFortress = state.pieces.some(
    (piece) => piece.type === 'fortress' && piece.hp === 1 && fortressMaximumHp(piece.owner) > 1,
  );
  document.body.classList.toggle('fortress-critical', criticalFortress && !state.outcome);
  const statusKey = `${state.activePlayer}:${state.ply}:${fortressState}:${JSON.stringify(state.outcome)}:${gameMode}:${machineThinking}:${machineSearch?.completedDepth ?? 0}:${scenarioProgress?.remainingPlies ?? ''}`;
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
        ? machineSearch
          ? `IA · profundidad ${machineSearch.completedDepth}/${machineSearch.requestedDepth}`
          : 'Máquina pensando…'
        : 'Máquina en mando'
      : `${PLAYER_NAMES[state.activePlayer]} en mando`;
    const mission = activeScenario
      ? `<small>${escapeHtml(
          scenarioLessonAt(activeScenario, state.ply - activeScenario.initialState.ply),
        )}${
          scenarioProgress?.remainingPlies === null ||
          scenarioProgress?.remainingPlies === undefined
            ? ''
            : ` · quedan ${scenarioProgress.remainingPlies}`
        }</small>`
      : '';
    turnChip.innerHTML = `<span>TURNO ${Math.floor(state.ply / 2) + 1}</span><strong>${commander}</strong>${mission}`;
  }
}

function renderClockDisplay(): void {
  if (!matchClockDisplay) return;
  const clock = matchRecord?.clock;
  matchClockDisplay.hidden = !clock;
  if (!clock) {
    matchClockDisplay.innerHTML = '';
    return;
  }
  const activeRemaining = clock.remainingMs[clock.activePlayer];
  const urgency =
    activeRemaining <= 20_000 ? 'critical' : activeRemaining <= 60_000 ? 'warning' : '';
  matchClockDisplay.className = `match-clock ${clock.status} ${urgency}`.trim();
  matchClockDisplay.innerHTML = ([0, 1] as const)
    .map(
      (player) =>
        `<span class="clock-side ${clock.activePlayer === player && clock.status === 'running' ? 'active' : ''}"><small>${PLAYER_NAMES[player]}</small><strong>${formatClock(clock.remainingMs[player])}</strong></span>`,
    )
    .join('');
  matchClockDisplay.setAttribute(
    'aria-label',
    `Reloj: Cian ${formatClock(clock.remainingMs[0])}, Ámbar ${formatClock(clock.remainingMs[1])}`,
  );
}

function formatClock(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderFortressStatus(player: 0 | 1, element: HTMLElement): void {
  const fortress = state.pieces.find(
    (piece) => piece.type === 'fortress' && piece.owner === player,
  );
  const hp = fortress?.type === 'fortress' ? fortress.hp : 0;
  const maxHp = fortressMaximumHp(player);
  element.innerHTML = `
    ${factionMarkMarkup(player)}
    <div><small>${PLAYER_NAMES[player]}</small><strong>Fortaleza</strong></div>
    <span class="hp" role="img" aria-label="${hp} de ${maxHp} puntos de vida">
      ${Array.from({ length: maxHp }, (_, index) => index + 1)
        .map(
          (point) =>
            `<i class="${hp >= point ? 'active' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 21s-8.5-5.2-8.5-12A4.5 4.5 0 0 1 12 6.9 4.5 4.5 0 0 1 20.5 9c0 6.8-8.5 12-8.5 12Z"/></svg></i>`,
        )
        .join('')}
    </span>`;
}

function fortressMaximumHp(player: 0 | 1): 1 | 2 | 3 {
  const configured = matchConfig?.setup.find(
    ({ piece }) => piece.type === 'fortress' && piece.owner === player,
  )?.piece;
  return configured?.type === 'fortress' ? configured.hp : 2;
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
      ? `Objetivo: ${activeScenario.summary} · ${scenarioLessonAt(activeScenario, state.ply - activeScenario.initialState.ply)}`
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
            ? `<span>Integridad <strong>${piece.hp}/${fortressMaximumHp(piece.owner)} HP</strong></span>`
            : '';
  const layer = isAirPiece(piece) ? 'Aire' : 'Suelo';
  const q = piece.position.q >= 0 ? `+${piece.position.q}` : `${piece.position.q}`;
  const r = piece.position.r >= 0 ? `+${piece.position.r}` : `${piece.position.r}`;
  const threatNote = threatSummaryMarkup(piece);
  pieceCard.className = `piece-card player-${piece.owner === 0 ? 'blue' : 'amber'}`;
  pieceCard.innerHTML = `
    <div class="piece-title-row">
      <div class="piece-monogram">${pieceMonogram(piece)}</div>
      <div><span class="eyebrow">${PLAYER_NAMES[piece.owner]} · ${layer}</span><h2>${PIECE_NAMES[piece.type]}</h2></div>
      <span class="unit-state ${ownTurn ? 'ready' : ''}">${ownTurn ? 'LISTA' : 'INSPECCIÓN'}</span>
    </div>
    <p>${pieceDescription(piece)}</p>
    ${threatNote}
    <div class="piece-stats"><span>Coordenadas <strong>${q}, ${r}</strong></span>${facing}${piece.type === 'long' ? `<span>Misiles <strong>${piece.missilesRemaining ?? 2}/2</strong></span>` : ''}</div>`;
  selectionSummary.textContent =
    activeScenario && ownTurn
      ? `Objetivo: ${activeScenario.summary} · ${scenarioLessonAt(activeScenario, state.ply - activeScenario.initialState.ply)}`
      : ownTurn
        ? preferences.contextualHints
          ? contextualHint(piece)
          : `${PIECE_NAMES[piece.type]} seleccionada · elige una orden o un destino marcado.`
        : `${PIECE_NAMES[piece.type]} de ${PLAYER_NAMES[piece.owner]} · inspección táctica; sus amenazas aparecen atenuadas.`;
}

function threatSummaryMarkup(piece: Piece): string {
  if (!preferences.tacticalThreats || piece.owner !== state.activePlayer) return '';
  const threats = analyzeImmediateThreats(state, piece.owner).threats.filter(
    (threat) => threat.targetId === piece.id,
  );
  if (!threats.length) return '';
  const attackers = [
    ...new Set(
      threats
        .map((threat) => getPiece(state, threat.attackerId))
        .filter((attacker): attacker is Piece => Boolean(attacker))
        .map((attacker) => PIECE_NAMES[attacker.type]),
    ),
  ];
  return `<div class="threat-note" role="status"><strong>Amenaza inmediata</strong><span>${escapeHtml(attackers.join(', '))}</span></div>`;
}

function contextualHint(piece: Piece): string {
  const hints: Record<Piece['type'], string> = {
    soldier: 'Consejo · El Soldado avanza por su arco frontal; girarlo también consume el turno.',
    capturer: 'Consejo · El Capturador convierte una unidad adyacente sin desplazarse.',
    medium: 'Consejo · El Tanque puede mover y elegir la orientación final del cañón.',
    long: 'Consejo · El Lanzamisiles tiene dos misiles para toda la partida y dispara a tres hexágonos exactos.',
    fast: 'Consejo · El Embestidor recorre una línea libre y captura ocupando el destino.',
    drone: 'Consejo · El Dron puede volar y compartir casilla con una unidad terrestre.',
    airplane: 'Consejo · El Avión elige entre volar y disparar; entrar en un escudo lo destruye.',
    antiAir: 'Consejo · El Escudo antiaéreo es inmóvil y protege las seis casillas adyacentes.',
    fortress: `Consejo · La Fortaleza tiene ${fortressMaximumHp(piece.owner)} HP; protégela para evitar la derrota.`,
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
      ? `<div class="control-section machine-wait"><span class="thinking-pulse" aria-hidden="true"></span><strong>Máquina pensando</strong><p>${machineSearch ? `Profundidad ${machineSearch.completedDepth}/${machineSearch.requestedDepth} · ${machineSearch.nodes.toLocaleString('es-ES')} posiciones` : 'Evaluando el frente, la seguridad y las amenazas tácticas.'}</p><div class="ai-progress" role="progressbar" aria-label="Progreso de cálculo" aria-valuemin="0" aria-valuemax="${machineSearch?.requestedDepth ?? 1}" aria-valuenow="${machineSearch?.completedDepth ?? 0}"><i style="--ai-progress:${machineSearch ? machineSearch.completedDepth / machineSearch.requestedDepth : 0}"></i></div></div>`
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
    const transformFacing = mode.facing;
    const attackAbove =
      transformFacing === null
        ? undefined
        : legalActions.find(
            (action) =>
              action.kind === 'transform' &&
              action.facing === transformFacing &&
              Boolean(action.attackAboveId),
          );
    actionControls.innerHTML = `${directionPanel('Abandonar vehículo', null, mode.facing, 'transform-facing')}
      <div class="transform-note"><strong>Acción inmediata</strong><span>Tras elegir orientación, confirma sin mover, toca un destino frontal o ataca al Dron situado encima.</span></div>
      ${attackAbove ? '<button type="button" class="stacked-response" data-transform-attack>Transformarse y atacar al Dron superior</button>' : ''}`;
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
    actionControls.querySelector('[data-transform-attack]')?.addEventListener('click', () => {
      if (attackAbove) setPending(attackAbove);
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
  const captureAbove = legalActions.find(
    (action): action is Extract<GameAction, { kind: 'convert' }> => {
      if (action.kind !== 'convert') return false;
      const target = getPiece(state, action.targetId);
      return Boolean(target && equalHex(target.position, piece.position) && isAirPiece(target));
    },
  );
  const captureAboveTarget = captureAbove ? getPiece(state, captureAbove.targetId) : undefined;

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
        ${captureAboveTarget ? `<button type="button" data-command="capture-above">${escapeHtml(captureAboveCommandLabel(captureAboveTarget.type))}</button>` : ''}
        ${canTransform ? '<button type="button" class="danger-command" data-command="transform">Abandonar vehículo</button>' : ''}
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
  actionControls.querySelector('[data-command="capture-above"]')?.addEventListener('click', () => {
    if (captureAbove) setPending(captureAbove);
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
  const consequences = analyzeActionConsequences(
    state,
    action,
    matchConfig ? resolutionRulesForConfig(matchConfig) : undefined,
  );
  const tone = consequenceTone(consequences);
  const toneClass =
    tone === 'warning'
      ? 'tone-danger'
      : tone === 'favorable' || tone === 'decisive'
        ? 'tone-positive'
        : 'tone-neutral';
  const mediumMove = piece?.type === 'medium' && action.kind === 'move';
  const cannon =
    piece?.type === 'medium' && action.kind === 'move' ? (action.cannon ?? piece.cannon) : null;
  pendingCard.innerHTML = `
    <div class="pending-label"><span>ORDEN PREPARADA</span><i></i></div>
    <strong>${escapeHtml(describeAction(state, action))}</strong>
    ${mediumMove ? `<div class="inline-direction"><span>Cañón tras mover</span>${directionButtons(cannon, 'pending-cannon')}</div>` : ''}
    <div class="consequence-lens ${toneClass}">
      <span class="eyebrow">CONSECUENCIA INMEDIATA</span>
      ${consequences.summaries.map((summary) => `<span class="consequence-item ${toneClass}">${escapeHtml(summary)}</span>`).join('')}
      ${consequences.outcomeLabel ? `<strong>${escapeHtml(consequences.outcomeLabel)}</strong>` : ''}
    </div>
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
  if (gameMode === 'academy' && activeScenario) return activeScenario.controlledPlayer;
  if (gameMode === 'machine') {
    const human = matchConfig?.participants.findIndex(
      (participant) => participant.kind === 'human',
    );
    return human === 1 ? 1 : 0;
  }
  return preferences.fixedBoard ? 0 : state.activePlayer;
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
        : action.kind === 'move'
          ? action.targetId
          : undefined;
  const target = targetId ? getPiece(state, targetId) : undefined;
  const destination = actionDestination(state, action);
  const destinationOccupancy = destination ? occupancyAt(state, destination) : undefined;
  if (action.kind === 'move' && action.kamikaze) {
    const victim = target ?? destinationOccupancy?.air ?? destinationOccupancy?.ground;
    return `<button type="button" data-action-choice="${index}"><span>KAMIKAZE</span><strong>Destruir ${victim ? PIECE_NAMES[victim.type] : 'objetivo'}</strong></button>`;
  }
  if (actor?.type === 'airplane' && action.kind === 'move' && destinationOccupancy?.ground) {
    return `<button type="button" data-action-choice="${index}"><span>SOBREVUELO</span><strong>Quedar sobre ${PIECE_NAMES[destinationOccupancy.ground.type]}</strong></button>`;
  }
  if (
    actor &&
    !isAirPiece(actor) &&
    action.kind === 'move' &&
    destinationOccupancy?.air?.type === 'airplane' &&
    destinationOccupancy.air.owner !== actor.owner
  ) {
    if (target?.id === destinationOccupancy.air.id) {
      return `<button type="button" data-action-choice="${index}"><span>ATAQUE</span><strong>Destruir Avión</strong></button>`;
    }
    return `<button type="button" data-action-choice="${index}"><span>MOVIMIENTO</span><strong>Quedar bajo Avión</strong></button>`;
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
  for (const button of [soundButton, homeSoundButton]) {
    button.classList.toggle('muted', !preferences.sound);
    button.setAttribute('aria-label', preferences.sound ? 'Silenciar sonido' : 'Activar sonido');
    button.setAttribute('aria-pressed', String(!preferences.sound));
    button.title = preferences.sound ? 'Silenciar sonido' : 'Activar sonido';
  }
}

function renderThreatToggle(): void {
  const enabled = preferences.tacticalThreats;
  const count = enabled ? analyzeImmediateThreats(state).threatenedPieceIds.length : 0;
  threatToggle.classList.toggle('active', enabled);
  threatToggle.setAttribute('aria-pressed', String(enabled));
  threatToggle.setAttribute(
    'aria-label',
    enabled
      ? `Ocultar amenazas inmediatas. ${count} ${count === 1 ? 'unidad amenazada' : 'unidades amenazadas'}`
      : 'Mostrar amenazas inmediatas',
  );
  threatToggle.title = enabled ? `Amenazas visibles · ${count}` : 'Amenazas inmediatas';
}

function renderScreenReaderBoard(): void {
  const rows: string[] = [];
  const inspected = selectedId ? getPiece(state, selectedId) : undefined;
  const actionLabel =
    inspected?.owner !== state.activePlayer ? 'Amenazas potenciales' : 'Acciones legales';
  const firingRange = new Set(currentFiringRange().map(hexKey));
  const threatenedPieces = new Set(
    preferences.tacticalThreats ? analyzeImmediateThreats(state).threatenedPieceIds : [],
  );
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
      const threatLabel = [occupancy.ground, occupancy.air].some(
        (piece) => piece && threatenedPieces.has(piece.id),
      )
        ? '. Amenaza inmediata rival'
        : '';
      const label = `${pieces.length ? pieces.join('. ') : `Casilla ${q}, ${r}, vacía`}${rangeLabel}${threatLabel}${legal.length ? `. ${actionLabel}: ${legal.join('; ')}` : ''}`;
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
  const threatenedPieces = new Set(
    preferences.tacticalThreats ? analyzeImmediateThreats(state).threatenedPieceIds : [],
  );
  const isThreatened = pieces.some((piece) => threatenedPieces.has(piece.id));
  announce(
    `${
      pieces.length
        ? pieces.map((piece) => pieceAccessibleLabel(state, piece, viewPlayer())).join('. ')
        : `Casilla ${hex.q}, ${hex.r}, vacía.`
    }${inFiringRange ? ' Alcance potencial de disparo.' : ''}${isThreatened ? ' Amenaza inmediata rival.' : ''}${legal.length ? ` ${actionLabel}: ${legal.join('; ')}.` : ''}`,
  );
}

function announce(message: string): void {
  announcer.textContent = '';
  window.setTimeout(() => {
    announcer.textContent = message;
  }, 20);
}

function showHomeScreen(view: 'main' | 'new' = 'main'): void {
  aiAbortController?.abort();
  if (matchController?.record.clock && !state.outcome) {
    matchController.pauseClock(Date.now());
    matchRecord = matchController.record;
    persistCurrentMatch();
  }
  stopHomeDemo();
  closeReplay({ resumeClock: false });
  if (dialog.open) dialog.close();
  gameMode = null;
  matchConfig = null;
  matchRecord = null;
  matchController = null;
  activeScenario = null;
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  lastEvents = [];
  state = createInitialState();
  focusedHex = { q: 0, r: 0 };
  machineThinking = false;
  machineSearch = null;
  scenarioProgress = null;
  scenarioHintsRevealed = 0;
  scenarioAttemptsRecorded = false;
  commandSheetExpanded = false;
  lastClockPersistSecond = -1;
  homeDemoBusy = false;
  renderedStatusKey = '';
  app.classList.add('home-active');
  document.body.classList.remove('fortress-critical', 'match-climax');
  homeScreen.hidden = false;
  homeScreen.inert = false;
  topbar.inert = true;
  gameLayout.inert = true;
  renderer.resetView();
  renderer.snapToPlayer(0);
  if (view === 'new') showHomeNewGameMenu();
  else showHomeMainMenu();
  render();
  startHomeDemo();
}

function leaveHomeScreen(): void {
  stopHomeDemo();
  app.classList.remove('home-active');
  homeScreen.hidden = true;
  homeScreen.inert = true;
  topbar.inert = false;
  gameLayout.inert = false;
  commandSheetExpanded = window.innerWidth > 760;
  renderCommandSheetState();
}

function isHomeScreenActive(): boolean {
  return app.classList.contains('home-active');
}

function fixedAcademyCompletedCount(): number {
  const fixedScenarioIds = new Set(SCENARIOS.map((scenario) => scenario.id));
  return new Set(loadAcademyProgress().filter((id) => fixedScenarioIds.has(id))).size;
}

function showHomeMainMenu(): void {
  const saved = loadActiveMatch();
  const completed = fixedAcademyCompletedCount();
  const history = loadMatchHistory();
  const continueDetail = saved.record
    ? `${saved.record.currentAction} órdenes guardadas · ${saved.record.config.participants[0].name} vs. ${saved.record.config.participants[1].name}`
    : saved.error
      ? 'La última partida no se pudo recuperar'
      : 'No hay una partida guardada';
  homeMenuContent.innerHTML = `
    <p class="home-intro">Domina el frente. Protege tu fortaleza.</p>
    <nav class="home-navigation" aria-label="Menú principal">
      <button type="button" class="home-nav-button primary" data-home-action="new">
        <span>Nueva partida</span><small>Configura un nuevo enfrentamiento</small>
      </button>
      <button type="button" class="home-nav-button" data-home-action="continue" ${saved.record ? '' : 'disabled'}>
        <span>Continuar partida</span><small>${escapeHtml(continueDetail)}</small>
      </button>
      <button type="button" class="home-nav-button" data-home-action="rules">
        <span>Reglas</span><small>Consulta unidades, acciones y victoria</small>
      </button>
      <button type="button" class="home-nav-button" data-home-action="tutorial">
        <span>Tutorial</span><small>${completed} de ${SCENARIOS.length} desafíos completados</small>
      </button>
      <button type="button" class="home-nav-button" data-home-action="lab">
        <span>Laboratorio</span><small>Crea, valida y juega tus propias misiones</small>
      </button>
      <button type="button" class="home-nav-button" data-home-action="history">
        <span>Historial</span><small>${history.length ? `${history.length} batallas concluidas` : 'Tus resultados aparecerán aquí'}</small>
      </button>
    </nav>`;
}

function showHomeNewGameMenu(): void {
  homeMenuContent.innerHTML = `
    <button type="button" class="home-back-button" data-home-action="back" aria-label="Volver al menú principal">← <span>Nueva partida</span></button>
    <p class="home-intro">Elige cómo quieres disputar la batalla.</p>
    <nav class="home-navigation mode-navigation" aria-label="Tipo de partida">
      <button type="button" class="home-nav-button primary" data-home-mode="machine">
        <span>Individual vs. IA</span><small>Juega contra la inteligencia artificial</small>
      </button>
      <button type="button" class="home-nav-button" data-home-mode="local">
        <span>Dos jugadores</span><small>Juega contra otra persona en el mismo ordenador</small>
      </button>
      <button type="button" class="home-nav-button" data-home-mode="academy">
        <span>Academia táctica</span><small>Aprende, practica y afronta el reto diario</small>
      </button>
    </nav>`;
}

function focusHomeControl(selector: string): void {
  window.requestAnimationFrame(() => {
    homeMenuContent.querySelector<HTMLButtonElement>(selector)?.focus();
  });
}

function onHomeMenuClick(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest<HTMLButtonElement>('button');
  if (!button || button.disabled) return;
  const action = button.dataset.homeAction;
  const requestedMode = button.dataset.homeMode;
  if (requestedMode === 'machine' || requestedMode === 'local') {
    showFreeMatchConfig(requestedMode);
    return;
  }
  if (requestedMode === 'academy') {
    gameMode = 'academy';
    showAcademyDialog();
    return;
  }
  if (action === 'new') showHomeNewGameMenu();
  else if (action === 'back') showHomeMainMenu();
  else if (action === 'rules') showRulesDialog();
  else if (action === 'lab') showScenarioEditorDialog();
  else if (action === 'history') showHistoryDialog();
  else if (action === 'tutorial') {
    gameMode = 'academy';
    showAcademyDialog();
  } else if (action === 'continue') {
    const saved = loadActiveMatch();
    if (!saved.record) {
      showToast('No hay una partida guardada que continuar.');
      showHomeMainMenu();
      return;
    }
    loadRecordIntoMatch(saved.record);
  }
}

function startHomeDemo(): void {
  stopHomeDemo();
  homeDemoTimer = window.setTimeout(() => void runHomeDemoTurn(), 850);
}

function stopHomeDemo(): void {
  if (homeDemoTimer !== null) window.clearTimeout(homeDemoTimer);
  homeDemoTimer = null;
}

async function runHomeDemoTurn(): Promise<void> {
  homeDemoTimer = null;
  if (!isHomeScreenActive() || homeDemoBusy) return;
  if (dialog.open || document.visibilityState === 'hidden') {
    homeDemoTimer = window.setTimeout(() => void runHomeDemoTurn(), 700);
    return;
  }
  if (state.outcome || state.ply >= 46) {
    state = createInitialState();
    lastEvents = [];
    renderer.snapToPlayer(0);
    render();
  }
  const action = chooseMachineAction(state);
  if (!action) {
    state = createInitialState();
    render();
    homeDemoTimer = window.setTimeout(() => void runHomeDemoTurn(), 900);
    return;
  }
  const before = state;
  const result = applyAction(state, action);
  if (!result.ok) {
    homeDemoTimer = window.setTimeout(() => void runHomeDemoTurn(), 900);
    return;
  }
  state = result.state;
  lastEvents = result.events;
  homeDemoBusy = true;
  render();
  try {
    await renderer.playEvents(result.events, before, preferences.reducedMotion);
  } finally {
    homeDemoBusy = false;
  }
  if (isHomeScreenActive()) homeDemoTimer = window.setTimeout(() => void runHomeDemoTurn(), 1_050);
}

function showNewGameDialog(): void {
  showHomeScreen('new');
}

function showGameModeDialog(initial: boolean): void {
  const saved = loadActiveMatch();
  const completed = fixedAcademyCompletedCount();
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
        <small>Elige entre Fácil, Media, Difícil y Experto.</small>
      </button>
      <button type="button" class="mode-card academy-card" data-game-mode="academy">
        <span class="mode-icon" aria-hidden="true">◎</span>
        <strong>Academia táctica</strong>
        <small>${completed} de ${SCENARIOS.length} desafíos completados.</small>
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
  let selectedPreset: MatchPresetId = 'tactical';
  let selectedDoctrine: AiPersonality = 'balanced';
  openDialog(`
    <button type="button" class="config-close" data-dialog-close aria-label="Cerrar configuración">×</button>
    <span class="eyebrow">NUEVA PARTIDA</span>
    <h2>${modeToConfigure === 'machine' ? 'Individual vs. IA' : 'Dos jugadores'}</h2>
    <p>Elige el ritmo primero. Siempre podrás afinar los detalles con la opción personalizada.</p>
    <div class="preset-grid" role="radiogroup" aria-label="Ritmo de partida">
      ${MATCH_PRESETS.map(
        (
          preset,
        ) => `<button type="button" class="preset-card ${preset.id === selectedPreset ? 'selected' : ''}" role="radio" aria-checked="${preset.id === selectedPreset}" data-preset="${preset.id}">
          <span class="preset-badge">${escapeHtml(preset.duration)}</span>
          <strong>${escapeHtml(preset.name)}</strong>
          <small>${escapeHtml(preset.description)}</small>
        </button>`,
      ).join('')}
    </div>
    <div class="match-options" data-custom-options hidden>
      <span class="eyebrow">AJUSTES PERSONALIZADOS</span>
      <label class="field-row"><span>Puntos de vida de la Fortaleza</span><select data-fortress-hp>
        <option value="1">1 · partida explosiva</option>
        <option value="2" selected>2 · equilibrio recomendado</option>
        <option value="3">3</option>
      </select></label>
      <label class="field-row"><span>Disposición inicial</span><select data-initial-layout>
        <option value="1" selected>Frente clásico</option>
        <option value="2">Columnas de asedio</option>
      </select></label>
    </div>
    ${
      modeToConfigure === 'machine'
        ? `<div class="match-options"><span class="eyebrow">MANDO RIVAL</span>
          <label class="field-row"><span>Dificultad</span><select data-ai-difficulty>
            <option value="recruit">Fácil</option>
            <option value="tactical" selected>Media</option>
            <option value="commander">Difícil</option>
            <option value="expert">Experto</option>
          </select></label>
          <div class="doctrine-grid" role="radiogroup" aria-label="Doctrina de la IA">
            ${aiDoctrineCards(selectedDoctrine)}
          </div>
          <p class="dialog-note" data-doctrine-description>${aiDoctrineDescription(selectedDoctrine)}</p>
        </div>`
        : ''
    }
    <div class="match-options">
      <span class="eyebrow">RELOJ POR JUGADOR</span>
      <label class="field-row"><span>Tiempo</span><select data-match-clock>
        <option value="" selected>Sin límite</option>
        <option value="300">5 minutos</option>
        <option value="600">10 minutos</option>
        <option value="1200">20 minutos</option>
      </select></label>
      <p class="dialog-note">El reloj es real, se guarda con la partida y la derrota por tiempo queda registrada.</p>
    </div>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-back-menu>Volver</button>
      <button type="button" class="confirm-button" data-start-free>Crear partida</button>
    </div>`);
  const refreshPreset = (): void => {
    dialog.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((button) => {
      const selected = button.dataset.preset === selectedPreset;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', String(selected));
    });
    const custom = dialog.querySelector<HTMLElement>('[data-custom-options]');
    if (custom) custom.hidden = selectedPreset !== 'custom';
    const clock = dialog.querySelector<HTMLSelectElement>('[data-match-clock]');
    if (clock && selectedPreset === 'skirmish' && !clock.value) clock.value = '600';
  };
  dialog.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedPreset = (button.dataset.preset as MatchPresetId) ?? 'tactical';
      refreshPreset();
      if (selectedPreset === 'custom') {
        window.requestAnimationFrame(() => {
          dialog
            .querySelector<HTMLElement>('[data-custom-options]')
            ?.scrollIntoView({ behavior: preferences.reducedMotion ? 'auto' : 'smooth' });
        });
      }
    });
  });
  dialog.querySelectorAll<HTMLButtonElement>('[data-ai-doctrine]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedDoctrine = (button.dataset.aiDoctrine as AiPersonality) ?? 'balanced';
      dialog.querySelectorAll<HTMLButtonElement>('[data-ai-doctrine]').forEach((candidate) => {
        const selected = candidate.dataset.aiDoctrine === selectedDoctrine;
        candidate.classList.toggle('selected', selected);
        candidate.setAttribute('aria-checked', String(selected));
      });
      const description = dialog.querySelector<HTMLElement>('[data-doctrine-description]');
      if (description) description.textContent = aiDoctrineDescription(selectedDoctrine);
    });
  });
  dialog.querySelector('[data-back-menu]')?.addEventListener('click', () => {
    if (isHomeScreenActive()) {
      dialog.close();
      showHomeNewGameMenu();
      focusHomeControl(`[data-home-mode="${modeToConfigure}"]`);
    } else showGameModeDialog(false);
  });
  dialog.querySelector('[data-start-free]')?.addEventListener('click', () => {
    const clockValue = dialog.querySelector<HTMLSelectElement>('[data-match-clock]')?.value;
    const fortressHpValue = Number(
      dialog.querySelector<HTMLSelectElement>('[data-fortress-hp]')?.value,
    );
    const fortressHp = (fortressHpValue === 1 || fortressHpValue === 3 ? fortressHpValue : 2) as
      1 | 2 | 3;
    const initialLayout =
      dialog.querySelector<HTMLSelectElement>('[data-initial-layout]')?.value === '2' ? 2 : 1;
    matchConfig = createPresetConfig(selectedPreset, {
      mode: modeToConfigure,
      difficulty:
        (dialog.querySelector<HTMLSelectElement>('[data-ai-difficulty]')?.value as AiDifficulty) ??
        'tactical',
      personality: selectedDoctrine,
      seed: createMatchSeed(),
      confirmation: preferences.confirmation,
      contextualHints: preferences.contextualHints,
      fixedBoard: preferences.fixedBoard,
      handoffScreen: preferences.handoffScreen,
      clockSeconds: clockValue ? Number(clockValue) : null,
      fortressHp,
      initialLayout,
    });
    gameMode = modeToConfigure;
    recordTelemetry('match-start', {
      mode: modeToConfigure,
      preset: selectedPreset,
      difficulty: matchConfig.participants[1].difficulty ?? 'human',
      personality: matchConfig.participants[1].personality ?? 'human',
    });
    dialog.close();
    leaveHomeScreen();
    resetGame();
  });
}

function showAcademyDialog(): void {
  const completed = new Set(loadAcademyProgress());
  const records = new Map(loadAcademyRecords().map((record) => [record.id, record]));
  const fixedCompleted = SCENARIOS.filter(
    (scenario) => records.get(scenario.id)?.completed ?? completed.has(scenario.id),
  ).length;
  const daily = dailyScenarioForDate();
  const groups: Array<{
    id: NonNullable<ScenarioDefinition['category']>;
    title: string;
    description: string;
    scenarios: ScenarioDefinition[];
  }> = [
    {
      id: 'daily',
      title: 'Reto diario',
      description: 'La misma misión local para todo el día; vuelve mañana para una nueva semilla.',
      scenarios: [daily],
    },
    {
      id: 'basic',
      title: 'Fundamentos',
      description: 'Una mecánica, una decisión clara.',
      scenarios: scenariosByCategory('basic'),
    },
    {
      id: 'guided',
      title: 'Batalla guiada',
      description: 'Combina piezas durante varios turnos con instrucciones por etapas.',
      scenarios: scenariosByCategory('guided'),
    },
    {
      id: 'strategic',
      title: 'Desafíos estratégicos',
      description: 'Objetivos abiertos para practicar tempo, defensa, protección y rutas.',
      scenarios: scenariosByCategory('strategic'),
    },
  ];
  const availableScenarios = groups.flatMap((group) => group.scenarios);
  openDialog(`
    <div class="academy-shell">
      <header class="academy-hero">
        <button type="button" class="academy-close" data-back-menu aria-label="Cerrar Academia">×</button>
        <div class="academy-intro">
          <span class="eyebrow">ACADEMIA TÁCTICA</span>
          <h2>Aprende, combina y domina</h2>
          <p>Practica una idea cada vez. Las pistas aparecen solo cuando las necesitas y una orden distinta no reinicia el ejercicio.</p>
        </div>
        <div class="academy-progress" aria-label="${fixedCompleted} de ${SCENARIOS.length} desafíos base completados">
          <div><span>PROGRESO BASE</span><strong>${fixedCompleted} / ${SCENARIOS.length}</strong></div>
          <progress max="${SCENARIOS.length}" value="${fixedCompleted}">${fixedCompleted} de ${SCENARIOS.length}</progress>
          <small>${fixedCompleted === SCENARIOS.length ? 'Entrenamiento base completado' : 'El reto diario cuenta por separado'}</small>
        </div>
      </header>
      <div class="academy-catalog">
        ${groups
          .map(
            (group) => `<section class="academy-section" data-academy-category="${group.id}">
              <div class="academy-header"><div><strong>${escapeHtml(group.title)}</strong><small>${escapeHtml(group.description)}</small></div><span class="academy-count" aria-label="${group.scenarios.length} ${group.scenarios.length === 1 ? 'misión' : 'misiones'}">${group.scenarios.length}</span></div>
              <div class="scenario-list">
                ${group.scenarios.map((scenario) => academyScenarioCard(scenario, records.get(scenario.id), completed.has(scenario.id))).join('')}
              </div>
            </section>`,
          )
          .join('')}
        <div class="dialog-actions academy-actions"><button type="button" class="secondary-button" data-back-menu>Volver al menú</button></div>
      </div>
    </div>`);
  dialog.querySelectorAll('[data-back-menu]').forEach((button) => {
    button.addEventListener('click', () => {
      if (isHomeScreenActive()) {
        dialog.close();
        showHomeMainMenu();
        focusHomeControl('[data-home-action="tutorial"]');
      } else showGameModeDialog(false);
    });
  });
  dialog.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((button) => {
    button.addEventListener('click', () => {
      const scenario = availableScenarios.find(
        (candidate) => candidate.id === button.dataset.scenario,
      );
      if (!scenario) return;
      startScenario(scenario);
    });
  });
}

function academyScenarioCard(
  scenario: ScenarioDefinition,
  record: AcademyRecord | undefined,
  legacyCompleted: boolean,
): string {
  const completed = record?.completed ?? legacyCompleted;
  const medal = record?.medal ?? null;
  const difficulty = '◆'.repeat(scenario.difficulty ?? 1);
  return `<button type="button" class="scenario-card" data-scenario="${escapeHtml(scenario.id)}">
    <span class="medal ${medal ?? (completed ? 'bronze' : '')}" aria-hidden="true">${medal === 'gold' ? '◆' : medal === 'silver' ? '◇' : completed ? '✓' : '○'}</span>
    <span class="scenario-card-copy">
      <strong>${escapeHtml(scenario.title)}</strong>
      <small>${escapeHtml(scenario.summary)}</small>
      <span class="scenario-meta"><span aria-label="Dificultad ${scenario.difficulty ?? 1} de 3">Nivel ${difficulty}</span>${record?.bestPlies ? `<span>Mejor marca: ${record.bestPlies}</span>` : `<span>${completed ? 'Completado' : 'Sin completar'}</span>`}</span>
    </span>
  </button>`;
}

function academyMedalLabel(medal: AcademyRecord['medal']): string {
  return medal === 'gold'
    ? 'Medalla de oro · sin pistas y ruta directa'
    : medal === 'silver'
      ? 'Medalla de plata · una pista'
      : medal === 'bronze'
        ? 'Medalla de bronce · objetivo cumplido'
        : 'Objetivo cumplido';
}

function revealOneScenarioHint(scenario: ScenarioDefinition, container: ParentNode): void {
  const reveal = nextScenarioHint(scenario, scenarioHintsRevealed);
  if (!reveal.hint) {
    showToast('Ya has revelado todas las pistas de esta misión.');
    return;
  }
  scenarioHintsRevealed = reveal.revealedCount;
  persistScenarioHints(scenario);
  recordTelemetry('academy-hint', {
    scenario: scenario.id,
    revealed: scenarioHintsRevealed,
  });
  const list = container.querySelector<HTMLOListElement>('[data-hint-list]');
  if (list) {
    list.innerHTML = revealedScenarioHints(scenario, scenarioHintsRevealed)
      .map((hint) => `<li>${escapeHtml(hint)}</li>`)
      .join('');
  }
  const button = container.querySelector<HTMLButtonElement>('[data-reveal-scenario-hint]');
  if (button) {
    button.textContent = reveal.exhausted ? 'Todas las pistas reveladas' : 'Revelar otra pista';
    button.disabled = reveal.exhausted;
  }
  announce(`Pista ${scenarioHintsRevealed} de ${reveal.total}: ${reveal.hint}`);
}

function persistScenarioHints(scenario: ScenarioDefinition): void {
  if (!matchRecord) return;
  const updated = setAcademySession(matchRecord, {
    scenarioId: scenario.id,
    hintsRevealed: scenarioHintsRevealed,
  });
  matchRecord = updated;
  if (matchController) matchController.record = updated;
  persistCurrentMatch();
}

function showRulesDialog(initialId = RULE_SECTIONS[0]?.id): void {
  const initial = RULE_SECTIONS.find((section) => section.id === initialId) ?? RULE_SECTIONS[0];
  if (!initial) return;
  openDialog(`
    <div class="rules-shell">
      <aside class="rules-sidebar">
        <div class="rules-heading">
          <div>
            <span class="rules-kicker">MANUAL DE CAMPO</span>
            <h2>Reglas</h2>
          </div>
          <button type="button" class="rules-close" data-dialog-close aria-label="Cerrar reglas">×</button>
        </div>
        <p>Selecciona una sección para consultar las reglas de Protocolo Hexagonal.</p>
        <label class="rules-search">
          <span class="sr-only">Buscar en las reglas</span>
          <input type="search" data-rule-search placeholder="Buscar..." autocomplete="off" />
        </label>
        <div class="rules-navigation" role="tablist" aria-label="Secciones del reglamento">
          ${RULE_SECTIONS.map(
            (section) =>
              `<button type="button" role="tab" data-rule-section="${escapeHtml(section.id)}" aria-selected="${section.id === initial.id}" aria-controls="rules-article" class="${section.id === initial.id ? 'active' : ''}">${escapeHtml(section.label)}</button>`,
          ).join('')}
        </div>
      </aside>
      <article id="rules-article" class="rules-article" role="tabpanel">
        ${ruleSectionMarkup(initial)}
      </article>
    </div>`);
  const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('[data-rule-section]')];
  const navigation = dialog.querySelector<HTMLElement>('.rules-navigation');
  const horizontalRuleTabs = window.matchMedia('(max-width: 760px) and (orientation: portrait)');
  const syncRuleTabOrientation = (): void => {
    navigation?.setAttribute(
      'aria-orientation',
      horizontalRuleTabs.matches ? 'horizontal' : 'vertical',
    );
  };
  syncRuleTabOrientation();
  horizontalRuleTabs.addEventListener('change', syncRuleTabOrientation);
  let activeDemo = mountRuleDemoInArticle(initial);
  let showingEmptySearch = false;
  const activate = (id: string, moveFocus = true): void => {
    const section = RULE_SECTIONS.find((candidate) => candidate.id === id);
    const article = dialog.querySelector<HTMLElement>('#rules-article');
    if (!section || !article) return;
    for (const tab of tabs) {
      const active = tab.dataset.ruleSection === section.id;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    activeDemo?.destroy();
    article.innerHTML = ruleSectionMarkup(section);
    article.scrollTop = 0;
    activeDemo = mountRuleDemoInArticle(section);
    if (moveFocus) article.querySelector<HTMLElement>('h3')?.focus();
  };
  dialog
    .querySelector<HTMLInputElement>('[data-rule-search]')
    ?.addEventListener('input', (event) => {
      const query = (event.currentTarget as HTMLInputElement).value.trim().toLocaleLowerCase('es');
      let firstVisible: HTMLButtonElement | undefined;
      for (const tab of tabs) {
        const section = RULE_SECTIONS.find((candidate) => candidate.id === tab.dataset.ruleSection);
        const searchable = section
          ? `${section.label} ${section.title} ${section.paragraphs.map(ruleParagraphText).join(' ')}`.toLocaleLowerCase(
              'es',
            )
          : '';
        const visible = !query || searchable.includes(query);
        tab.hidden = !visible;
        if (visible && !firstVisible) firstVisible = tab;
      }
      const activeVisible = tabs.some(
        (tab) => !tab.hidden && tab.getAttribute('aria-selected') === 'true',
      );
      const article = dialog.querySelector<HTMLElement>('#rules-article');
      if (!firstVisible && article) {
        activeDemo?.destroy();
        activeDemo = null;
        showingEmptySearch = true;
        article.innerHTML = `<div class="rules-empty" role="status"><strong>Sin coincidencias</strong><p>Prueba con el nombre de una unidad, acción o condición de victoria.</p></div>`;
        return;
      }
      if (showingEmptySearch && firstVisible) {
        showingEmptySearch = false;
        const selected = tabs.find(
          (tab) => !tab.hidden && tab.getAttribute('aria-selected') === 'true',
        );
        activate((selected ?? firstVisible).dataset.ruleSection ?? '', false);
      } else if (!activeVisible && firstVisible) {
        activate(firstVisible.dataset.ruleSection ?? '', false);
      }
    });
  tabs.forEach((tab) => {
    tab.tabIndex = tab.dataset.ruleSection === initial.id ? 0 : -1;
    tab.addEventListener('click', () => activate(tab.dataset.ruleSection ?? ''));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key))
        return;
      event.preventDefault();
      const visibleTabs = tabs.filter((candidate) => !candidate.hidden);
      const index = visibleTabs.indexOf(tab);
      if (index < 0 || visibleTabs.length === 0) return;
      const next =
        event.key === 'Home'
          ? visibleTabs[0]
          : event.key === 'End'
            ? visibleTabs.at(-1)!
            : visibleTabs[
                (index +
                  (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) +
                  visibleTabs.length) %
                  visibleTabs.length
              ];
      next.focus();
      activate(next.dataset.ruleSection ?? '', false);
    });
  });
  dialog.addEventListener(
    'close',
    () => {
      activeDemo?.destroy();
      activeDemo = null;
      horizontalRuleTabs.removeEventListener('change', syncRuleTabOrientation);
    },
    { once: true },
  );
}

function ruleSectionMarkup(section: RuleSection): string {
  const mediaItems = section.media ?? [];
  const media = section.demo
    ? `<figure class="rule-media rule-demo" aria-label="Demostración de ${escapeHtml(section.title)}">
        <div class="rule-media-stage">
          <canvas class="rule-demo-canvas"></canvas>
          <span class="rule-demo-badge" aria-hidden="true"><i></i> Demostración real</span>
        </div>
        <figcaption data-rule-demo-caption>Preparando la demostración…</figcaption>
        <div class="rule-demo-controls" aria-label="Controles de la demostración">
          <button type="button" data-demo-toggle>Pausar</button>
          <button type="button" data-demo-step>Paso a paso</button>
          <button type="button" data-demo-restart>Reiniciar</button>
        </div>
      </figure>`
    : mediaItems.length
      ? `<figure class="rule-media" aria-label="Ilustración de ${escapeHtml(section.title)}">
        <div class="rule-media-stage">
          <div class="rule-media-track">
            ${mediaItems
              .map(
                (item) =>
                  `<img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}" loading="lazy" />`,
              )
              .join('')}
          </div>
        </div>
      </figure>`
      : '';
  return `
    <div class="rules-copy">
      <span class="rules-kicker">PROTOCOLO HEXAGONAL</span>
      <h3 tabindex="-1">${escapeHtml(section.title)}</h3>
      ${section.paragraphs.map(ruleParagraphMarkup).join('')}
    </div>
    ${media}`;
}

function mountRuleDemoInArticle(section: RuleSection): { destroy(): void } | null {
  if (!section.demo) return null;
  const article = dialog.querySelector<HTMLElement>('#rules-article');
  const canvas = article?.querySelector<HTMLCanvasElement>('.rule-demo-canvas');
  const caption = article?.querySelector<HTMLElement>('[data-rule-demo-caption]');
  if (!canvas) return null;
  return mountRuleDemo(canvas, section.demo, {
    reducedMotion: preferences.reducedMotion,
    highContrast: preferences.highContrast,
    onSceneChange: (label, index, total) => {
      if (caption) caption.textContent = `${index + 1}/${total} · ${label}`;
    },
  });
}

function ruleParagraphText(paragraph: string | RuleParagraph): string {
  return typeof paragraph === 'string' ? paragraph : paragraph.text;
}

function ruleParagraphMarkup(paragraph: string | RuleParagraph): string {
  if (typeof paragraph !== 'string' && paragraph.kind === 'heading') {
    return `<h3 class="rules-peer-heading">${escapeHtml(paragraph.text)}</h3>`;
  }
  const text = ruleParagraphText(paragraph);
  const strong = typeof paragraph === 'string' ? [] : (paragraph.strong ?? []);
  return `<p>${ruleEmphasisMarkup(text, strong)}</p>`;
}

function ruleEmphasisMarkup(text: string, strong: string[]): string {
  let cursor = 0;
  let markup = '';
  for (const phrase of strong) {
    const index = text.indexOf(phrase, cursor);
    if (index < 0) continue;
    markup += escapeHtml(text.slice(cursor, index));
    markup += `<strong>${escapeHtml(phrase)}</strong>`;
    cursor = index + phrase.length;
  }
  return markup + escapeHtml(text.slice(cursor));
}

function showHelpDialog(): void {
  const fortressHp = fortressMaximumHp(0);
  openDialog(`
    <button type="button" class="dialog-dismiss" data-dialog-close aria-label="Cerrar ayuda">×</button>
    <span class="eyebrow">MANUAL DE CAMPO</span>
    <h2>${activeScenario ? escapeHtml(activeScenario.title) : 'Destruye la Fortaleza rival'}</h2>
    ${
      activeScenario
        ? `<div class="scenario-hints"><strong>Objetivo</strong><p>${escapeHtml(activeScenario.summary)}</p><p>${escapeHtml(scenarioLessonAt(activeScenario, state.ply - activeScenario.initialState.ply))}</p><ol data-hint-list>${revealedScenarioHints(
            activeScenario,
            scenarioHintsRevealed,
          )
            .map((hint) => `<li>${escapeHtml(hint)}</li>`)
            .join(
              '',
            )}</ol><button type="button" class="text-button" data-reveal-scenario-hint>${scenarioHintsRevealed ? 'Revelar otra pista' : 'Revelar una pista'}</button></div>`
        : ''
    }
    <div class="help-grid">
      <section><strong>1 · Selecciona</strong><p>Elige una unidad propia. Menta indica movimiento, rosa ataque, una red sobre el objetivo indica conversión y naranja intercepción.</p></section>
      <section><strong>2 · Prepara</strong><p>Toca destino. En casillas apiladas podrás elegir aire o suelo. Revisa consecuencia antes de confirmar.</p></section>
      <section><strong>3 · Confirma</strong><p>Cada turno exige una acción. Girar Soldado y orientar cañón también consumen turno.</p></section>
      <section><strong>Victoria</strong><p>${escapeHtml(fortressAttackSummary(fortressHp))}</p></section>
    </div>
    <details><summary>Reglas tácticas esenciales</summary>
      <p>${escapeHtml(CLASSIC_RULES_NOTE)}</p>
      <p>El Lanzamisiles tiene dos disparos por partida y alcanza el anillo de distancia 3. Drones y Aviones comparten la capa aérea y pueden apilarse sobre una unidad terrestre, pero no atravesarse entre sí.</p>
      <p>Las unidades terrestres pueden pasar y detenerse bajo un Avión enemigo sin atacarlo. Un Dron enemigo sigue bloqueando ese movimiento.</p>
      <p>El Avión vuela hasta dos casillas por su frente o dispara a su cono ofensivo. Su kamikaze destruye objetivo y Avión. El Escudo antiaéreo es inmóvil: pulveriza aeronaves enemigas y bloquea sus disparos.</p>
      <p>Tanque, Lanzamisiles y Embestidor pueden abandonarse y convertirse permanentemente en Soldados, con movimiento opcional inmediato.</p>
    </details>
    <div class="keyboard-card"><strong>Teclado</strong><span>Q/W/E y A/S/D cubren las seis direcciones · teclado numérico 7/8/9/4/2/6 · Enter selecciona · Esc cancela · H ayuda · L registro · C centra</span></div>
    <p class="game-credits">
      Juego ideado por
      <a href="https://www.instagram.com/roldan_musica" target="_blank" rel="noopener noreferrer">Miquel Roldán Llinàs</a>.
      <span>Programado por <a href="https://lisandrorocha.vercel.app/" target="_blank" rel="noopener noreferrer">Lisandro Rocha Tau</a>.</span>
    </p>
    <div class="dialog-actions"><button type="button" class="confirm-button" data-dialog-close>Entendido</button></div>`);
  if (activeScenario) {
    dialog
      .querySelector('[data-reveal-scenario-hint]')
      ?.addEventListener('click', () => revealOneScenarioHint(activeScenario!, dialog));
  }
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
      <div><span class="eyebrow">VISTA DEL TABLERO</span><p>Configura la profundidad y la orientación durante la partida.</p></div>
      <label class="toggle-row"><span><strong>Perspectiva 2.5D</strong><small>Inclina el tablero y eleva las unidades aéreas</small></span><input type="checkbox" data-pref="board-depth" ${preferences.boardDepth ? 'checked' : ''}/></label>
      <label class="toggle-row"><span><strong>Mantener tablero fijo</strong><small>Cian permanece abajo y Ámbar arriba durante toda la partida</small></span><input type="checkbox" data-pref="fixed-board" ${preferences.fixedBoard ? 'checked' : ''}/></label>
      <label class="field-row"><span>Confirmación de órdenes</span><select data-pref="confirmation"><option value="always" ${preferences.confirmation === 'always' ? 'selected' : ''}>Siempre</option><option value="critical" ${preferences.confirmation === 'critical' ? 'selected' : ''}>Solo críticas</option><option value="quick" ${preferences.confirmation === 'quick' ? 'selected' : ''}>Rápida</option></select></label>
      <label class="toggle-row"><span><strong>Consejos contextuales</strong><small>Muestra orientación cuando una mecánica sea relevante</small></span><input type="checkbox" data-pref="hints" ${preferences.contextualHints ? 'checked' : ''}/></label>
      <label class="toggle-row"><span><strong>Amenazas inmediatas</strong><small>Marca unidades que el rival puede atacar en su próxima orden</small></span><input type="checkbox" data-pref="threats" ${preferences.tacticalThreats ? 'checked' : ''}/></label>
      <label class="toggle-row"><span><strong>Pantalla de entrega</strong><small>Oculta la posición entre turnos locales</small></span><input type="checkbox" data-pref="handoff" ${preferences.handoffScreen ? 'checked' : ''}/></label>
    </div>
    <div class="accessibility-settings">
      <div><span class="eyebrow">ACCESIBILIDAD</span><p>Adapta la presentación visual a tus necesidades.</p></div>
      <label class="toggle-row"><span><strong>Alto contraste</strong><small>Refuerza bordes y colores del tablero</small></span><input type="checkbox" data-pref="contrast" ${preferences.highContrast ? 'checked' : ''}/></label>
      <label class="toggle-row"><span><strong>Reducir movimiento</strong><small>Limita animaciones y transiciones</small></span><input type="checkbox" data-pref="motion" ${preferences.reducedMotion ? 'checked' : ''}/></label>
    </div>
    <div class="board-settings">
      <div><span class="eyebrow">PARTIDA ACTUAL</span><p>Las herramientas avanzadas y los datos viven en un centro independiente.</p></div>
      <div class="inline-actions">
        <button type="button" class="secondary-button" data-data-center>Partidas y datos</button>
        <button type="button" class="text-button" data-scenario-editor>Laboratorio</button>
        <button type="button" class="text-button data-danger" data-resign-match ${matchRecord && !state.outcome && !activeScenario ? '' : 'disabled'}>Rendirse</button>
      </div>
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
    .querySelector<HTMLInputElement>('[data-pref="board-depth"]')
    ?.addEventListener('change', (event) => {
      preferences.boardDepth = (event.currentTarget as HTMLInputElement).checked;
      savePreferences();
      renderer.setDepthMode(preferences.boardDepth, preferences.reducedMotion);
      announce(preferences.boardDepth ? 'Perspectiva 2.5D activada.' : 'Perspectiva 2D activada.');
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
    ['[data-pref="threats"]', 'tacticalThreats'],
    ['[data-pref="handoff"]', 'handoffScreen'],
  ] as const) {
    dialog.querySelector<HTMLInputElement>(selector)?.addEventListener('change', (event) => {
      preferences[key] = (event.currentTarget as HTMLInputElement).checked;
      savePreferences();
      if (key === 'tacticalThreats') render();
    });
  }
  dialog.querySelector('[data-data-center]')?.addEventListener('click', showDataCenterDialog);
  dialog.querySelector('[data-resign-match]')?.addEventListener('click', showResignDialog);
  dialog
    .querySelector('[data-scenario-editor]')
    ?.addEventListener('click', showScenarioEditorDialog);
}

function showDataCenterDialog(): void {
  const events = loadTelemetry();
  const summary = telemetrySummary(events);
  const telemetryTotal = events.length;
  openDialog(`
    <span class="eyebrow">PARTIDAS Y DATOS</span>
    <h2>Archivo local</h2>
    <p>Todo se guarda únicamente en este navegador. No se transmite ninguna partida ni diagnóstico.</p>
    <section class="board-settings">
      <div><span class="eyebrow">REPETICIONES</span><p>Los archivos se validan antes de cargarse.</p></div>
      <div class="inline-actions">
        <button type="button" class="secondary-button" data-export-match ${matchRecord ? '' : 'disabled'}>Exportar partida</button>
        <button type="button" class="secondary-button" data-import-match>Importar JSON</button>
        <button type="button" class="text-button" data-open-replay ${matchRecord ? '' : 'disabled'}>Analizar tablero</button>
        <button type="button" class="text-button" data-undo-match ${matchController?.record.config.options.allowUndo && matchController.record.currentAction > 0 && !state.outcome ? '' : 'disabled'}>Deshacer última orden</button>
        <button type="button" class="text-button" data-history>Historial de resultados</button>
      </div>
      <input type="file" accept="application/json,.json" data-import-file hidden/>
    </section>
    <section class="telemetry-summary">
      <div><span class="eyebrow">DIAGNÓSTICO DE PLAYTEST</span><p>${telemetryTotal} eventos locales · ${summary['match-start'] ?? 0} partidas iniciadas · ${summary['action-cancelled'] ?? 0} órdenes canceladas · ${summary['academy-hint'] ?? 0} pistas usadas.</p></div>
      <div class="inline-actions">
        <button type="button" class="secondary-button" data-export-telemetry ${telemetryTotal ? '' : 'disabled'}>Exportar diagnóstico</button>
        <button type="button" class="text-button data-danger" data-clear-telemetry ${telemetryTotal ? '' : 'disabled'}>Borrar diagnóstico</button>
        <button type="button" class="text-button data-danger" data-reset-academy>Reiniciar Academia</button>
      </div>
    </section>
    <div class="dialog-actions"><button type="button" class="secondary-button" data-back-settings>Volver a opciones</button><button type="button" class="confirm-button" data-dialog-close>Listo</button></div>`);
  dialog.querySelector('[data-back-settings]')?.addEventListener('click', showSettingsDialog);
  dialog.querySelector('[data-export-match]')?.addEventListener('click', exportCurrentMatch);
  dialog.querySelector('[data-open-replay]')?.addEventListener('click', () => showReplayDialog());
  dialog.querySelector('[data-undo-match]')?.addEventListener('click', undoLastAction);
  dialog.querySelector('[data-history]')?.addEventListener('click', showHistoryDialog);
  const importInput = dialog.querySelector<HTMLInputElement>('[data-import-file]');
  dialog
    .querySelector('[data-import-match]')
    ?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (file) void importMatchFile(file);
  });
  dialog.querySelector('[data-export-telemetry]')?.addEventListener('click', () => {
    downloadText('protocolo-hexagonal-playtest.json', serializeTelemetry());
  });
  bindTwoStepDestructive('[data-clear-telemetry]', 'Confirmar borrado', () => {
    clearTelemetry();
    showToast('Diagnóstico local borrado.');
    showDataCenterDialog();
  });
  bindTwoStepDestructive('[data-reset-academy]', 'Confirmar reinicio', () => {
    resetAcademyProgress();
    showToast('Progreso de Academia reiniciado.');
    showDataCenterDialog();
  });
}

function showResignDialog(): void {
  if (!matchController || state.outcome || activeScenario) return;
  openDialog(`
    <span class="eyebrow">CONFIRMAR RENDICIÓN</span>
    <h2>${PLAYER_NAMES[state.activePlayer]} abandona la batalla</h2>
    <p>La victoria del rival quedará registrada y podrá revisarse en el análisis.</p>
    <div class="dialog-actions"><button type="button" class="secondary-button" data-dialog-close>Seguir jugando</button><button type="button" class="confirm-button data-danger" data-confirm-resign>Rendirse</button></div>`);
  dialog.querySelector('[data-confirm-resign]')?.addEventListener('click', () => {
    if (!matchController) return;
    if (matchController.record.clock) matchController.pauseClock(Date.now());
    matchController.resign(state.activePlayer);
    matchRecord = matchController.record;
    state = matchController.store.getState().game;
    persistCurrentMatch();
    dialog.close();
    renderedStatusKey = '';
    render();
    presentOutcome();
  });
}

function showHistoryDialog(): void {
  const history = loadMatchHistory();
  openDialog(`
    <span class="eyebrow">HISTORIAL LOCAL</span>
    <h2>Batallas concluidas</h2>
    <p>Un registro breve de resultados; las repeticiones completas se exportan por separado.</p>
    <div class="history-list">
      ${
        history.length
          ? history
              .map(
                (entry) =>
                  `<article class="history-card"><span>${new Date(entry.completedAt).toLocaleDateString('es-ES')}</span><strong>${escapeHtml(outcomeText(entry.outcome))}</strong><small>${escapeHtml(entry.participants.join(' vs. '))} · ${entry.plies} órdenes · ${formatDuration(entry.durationSeconds)}</small></article>`,
              )
              .join('')
          : '<div class="empty-state"><strong>Aún no hay resultados</strong><p>Termina una partida libre para inaugurar el archivo.</p></div>'
      }
    </div>
    <div class="dialog-actions"><button type="button" class="secondary-button" data-history-back>Volver</button><button type="button" class="confirm-button" data-dialog-close>Listo</button></div>`);
  dialog.querySelector('[data-history-back]')?.addEventListener('click', () => {
    if (isHomeScreenActive()) {
      dialog.close();
      showHomeMainMenu();
    } else showDataCenterDialog();
  });
}

function bindTwoStepDestructive(
  selector: string,
  confirmationLabel: string,
  action: () => void,
): void {
  const button = dialog.querySelector<HTMLButtonElement>(selector);
  if (!button) return;
  button.addEventListener('click', () => {
    if (button.dataset.confirmed === 'true') {
      action();
      return;
    }
    button.dataset.confirmed = 'true';
    button.textContent = confirmationLabel;
    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.dataset.confirmed = 'false';
      button.textContent = selector.includes('academy')
        ? 'Reiniciar Academia'
        : 'Borrar diagnóstico';
    }, 4_000);
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
  if (matchController && result.state.outcome) {
    if (matchController.record.clock) matchController.pauseClock(Date.now());
    matchController.conclude(result.state.outcome);
    matchRecord = matchController.record;
    state = matchController.store.getState().game;
    persistCurrentMatch();
  } else {
    state = result.state;
  }
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
  presentOutcome();
}

function blockadePreview(): string {
  return 'tablas';
}

function showOutcomeDialog(): void {
  if (!state.outcome) return;
  const winnerClass =
    state.outcome.type === 'win' ? (state.outcome.winner === 0 ? 'blue' : 'amber') : 'draw';
  const remainingBlue = state.pieces.filter((piece) => piece.owner === 0).length;
  const remainingAmber = state.pieces.filter((piece) => piece.owner === 1).length;
  const statistics = matchRecord ? calculateStatistics(matchRecord) : null;
  const moments = matchRecord ? analyzeMatchMoments(matchRecord) : [];
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
    ${
      moments.length
        ? `<section class="key-moments"><div><span class="eyebrow">TRES MOMENTOS CLAVE</span><p>Salta directamente a los giros que más cambiaron la batalla.</p></div>${moments
            .map(
              (moment) =>
                `<button type="button" class="moment-card" data-moment-jump="${moment.actionIndex}"><span>Orden ${moment.actionIndex}</span><strong>${escapeHtml(moment.title)}</strong><small>${escapeHtml(moment.detail)}</small></button>`,
            )
            .join('')}</section>`
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
      showHomeScreen('new');
    });
  });
  dialog.querySelector('[data-rematch]')?.addEventListener('click', () => {
    dialog.close();
    resetGame();
  });
  dialog.querySelector('[data-analyze]')?.addEventListener('click', () => showReplayDialog());
  dialog.querySelectorAll<HTMLButtonElement>('[data-moment-jump]').forEach((button) => {
    button.addEventListener('click', () => showReplayDialog(Number(button.dataset.momentJump)));
  });
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
  if (isHomeScreenActive()) leaveHomeScreen();
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
  if (matchRecord.clock) matchController.resumeClock(Date.now());
  matchRecord = matchController.record;
  state = matchController.store.getState().game;
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
  machineSearch = null;
  scenarioProgress = null;
  scenarioHintsRevealed = 0;
  scenarioAttemptsRecorded = false;
  outcomePresentedFor = '';
  lastClockPersistSecond = -1;
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
  if (isHomeScreenActive()) leaveHomeScreen();
  aiAbortController?.abort();
  activeScenario = scenario;
  gameMode = 'academy';
  matchConfig = createClassicConfig({
    mode: 'machine',
    difficulty: scenario.difficulty === 3 ? 'commander' : 'tactical',
    personality: scenario.objective.kind === 'survive' ? 'aggressive' : 'balanced',
    seed: createMatchSeed(),
    confirmation: preferences.confirmation,
    contextualHints: true,
    fixedBoard: true,
    handoffScreen: false,
    noProgressPlyLimit: null,
  });
  if (scenario.controlledPlayer === 1) {
    matchConfig = {
      ...matchConfig,
      participants: [
        { ...matchConfig.participants[1], name: 'Mando automático Cian' },
        { kind: 'human', name: 'Comando Ámbar' },
      ],
    };
  }
  matchConfig = {
    ...matchConfig,
    definitionId: `scenario:${scenario.id}`,
    setup: scenario.initialState.pieces.map((piece) => ({ id: piece.id, piece })),
    options: { ...matchConfig.options, allowUndo: true, clockSeconds: null },
  };
  matchRecord = setAcademySession(createMatchRecord(matchConfig, scenario.initialState), {
    scenarioId: scenario.id,
    hintsRevealed: 0,
  });
  matchController = new MatchController(matchRecord);
  state = replayRecord(matchRecord);
  persistCurrentMatch();
  selectedId = null;
  pendingAction = null;
  mode = { kind: 'default' };
  lastEvents = [];
  scenarioProgress = {
    status: 'in-progress',
    elapsedPlies: 0,
    remainingPlies: scenario.maxPlies ?? null,
    feedback: scenarioLessonAt(scenario, 0),
  };
  scenarioHintsRevealed = 0;
  scenarioAttemptsRecorded = false;
  machineSearch = null;
  outcomePresentedFor = '';
  focusedHex = { q: 0, r: 0 };
  renderer.resetView();
  renderer.snapToPlayer(scenario.controlledPlayer);
  renderedStatusKey = '';
  recordTelemetry('match-start', {
    mode: 'academy',
    scenario: scenario.id,
    difficulty: scenario.difficulty ?? 1,
  });
  render();
  announce(`${scenario.title}. ${scenario.summary}`);
  showScenarioBriefing(scenario);
}

function loadRecordIntoMatch(record: MatchRecord): void {
  if (isHomeScreenActive()) leaveHomeScreen();
  aiAbortController?.abort();
  const scenarioId = record.config.definitionId.startsWith('scenario:')
    ? record.config.definitionId.slice('scenario:'.length)
    : '';
  const dailyDate = scenarioId.startsWith('daily:') ? scenarioId.split(':')[1] : '';
  const restoredDaily = dailyDate ? dailyScenarioForDate(dailyDate) : null;
  const customId = scenarioId.startsWith('custom:') ? scenarioId.slice('custom:'.length) : '';
  const customScenario = customId
    ? loadScenarioCatalog().find((candidate) => candidate.id === customId)
    : undefined;
  const restoredCustom = customScenario ? customScenarioDefinition(customScenario) : null;
  activeScenario = scenarioId
    ? (scenarioById(scenarioId) ??
      (restoredDaily?.id === scenarioId ? restoredDaily : null) ??
      (restoredCustom?.id === scenarioId ? restoredCustom : null))
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
  scenarioHintsRevealed =
    activeScenario && record.academySession?.scenarioId === activeScenario.id
      ? record.academySession.hintsRevealed
      : 0;
  scenarioAttemptsRecorded = false;
  const restoredScenarioPlies = activeScenario
    ? Math.max(0, state.ply - activeScenario.initialState.ply)
    : 0;
  scenarioProgress = activeScenario
    ? {
        status: 'in-progress',
        elapsedPlies: restoredScenarioPlies,
        remainingPlies:
          activeScenario.maxPlies === undefined
            ? null
            : Math.max(0, activeScenario.maxPlies - restoredScenarioPlies),
        feedback: scenarioLessonAt(activeScenario, restoredScenarioPlies),
      }
    : null;
  renderer.resetView();
  renderer.snapToPlayer(viewPlayer());
  renderedStatusKey = '';
  outcomePresentedFor = '';
  machineSearch = null;
  lastClockPersistSecond = -1;
  if (matchController.record.clock && !state.outcome) {
    matchController.resumeClock(Date.now());
    matchRecord = matchController.record;
    state = matchController.store.getState().game;
  }
  render();
  if (state.outcome) {
    persistCurrentMatch();
    presentOutcome();
    return;
  }
  showToast(`Partida recuperada en la orden ${record.currentAction}.`);
  if (isMachineTurn()) void runMachineTurn();
}

function showScenarioSuccess(scenario: ScenarioDefinition): void {
  const record = loadAcademyRecords().find((candidate) => candidate.id === scenario.id);
  openDialog(`
    <div class="dialog-icon">${record?.medal === 'gold' ? '◆' : record?.medal === 'silver' ? '◇' : '✓'}</div>
    <span class="eyebrow">OBJETIVO COMPLETADO</span>
    <h2>${escapeHtml(scenario.title)}</h2>
    <p>${escapeHtml(scenario.successText)}</p>
    <div class="scenario-progress"><strong>${academyMedalLabel(record?.medal ?? null)}</strong><span>${record?.bestPlies ?? state.ply} órdenes · ${scenarioHintsRevealed} pistas usadas</span></div>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-retry-scenario>Repetir</button>
      <button type="button" class="confirm-button" data-academy-menu>Seguir entrenando</button>
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
    <div class="scenario-progress"><strong>${escapeHtml(scenarioLessonAt(scenario, 0))}</strong><span>${scenario.maxPlies ? `Límite: ${scenario.maxPlies} órdenes` : 'Sin límite estricto'}</span></div>
    <div class="scenario-hint">
      <p>Intenta leer la posición primero. Si te atascas, revela las pistas de una en una.</p>
      <ol class="scenario-steps" data-hint-list></ol>
      <button type="button" class="text-button" data-reveal-scenario-hint>Revelar primera pista</button>
    </div>
    <p class="dialog-note">El objetivo y la etapa vigente seguirán visibles sobre el tablero. Una orden alternativa ya no reinicia la misión.</p>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-academy-menu>Volver</button>
      <button type="button" class="confirm-button" data-dialog-close>Empezar ejercicio</button>
    </div>`);
  dialog.querySelector('[data-academy-menu]')?.addEventListener('click', showAcademyDialog);
  dialog
    .querySelector('[data-reveal-scenario-hint]')
    ?.addEventListener('click', () => revealOneScenarioHint(scenario, dialog));
}

function showScenarioRetry(scenario: ScenarioDefinition, feedback: string): void {
  openDialog(`
    <span class="eyebrow">REVISIÓN DEL EJERCICIO</span>
    <h2>La secuencia ha terminado</h2>
    <p>${escapeHtml(feedback)}</p>
    <p class="dialog-note"><strong>Objetivo:</strong> ${escapeHtml(scenario.summary)}</p>
    <ol class="scenario-steps">
      ${revealedScenarioHints(scenario, Math.max(1, scenarioHintsRevealed))
        .map((hint) => `<li>${escapeHtml(hint)}</li>`)
        .join('')}
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
  const preventDismiss = (event: Event): void => event.preventDefault();
  const cleanup = (): void => {
    dialog.removeEventListener('cancel', preventDismiss);
    dialog.removeEventListener('close', cleanup);
  };
  dialog.addEventListener('cancel', preventDismiss);
  dialog.addEventListener('close', cleanup);
  dialog.querySelector('[data-handoff-ready]')?.addEventListener('click', () => {
    startActiveTurnClock();
    dialog.close();
  });
}

function showReplayDialog(initialAction?: number): void {
  if (!matchRecord) return;
  if (dialog.open) dialog.close();
  closeReplay();
  replayClockWasRunning = matchController?.record.clock?.status === 'running';
  if (replayClockWasRunning && matchController) {
    matchController.pauseClock(Date.now());
    matchRecord = matchController.record;
    persistCurrentMatch();
  }
  const record = matchRecord;
  const moments = analyzeMatchMoments(record);
  const startingAction = Math.max(
    0,
    Math.min(record.actions.length, initialAction ?? record.currentAction),
  );
  const boardStage = document.querySelector<HTMLElement>('.board-stage');
  if (!boardStage) return;
  replayFocusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.classList.add('replay-active');
  commandSheetExpanded = false;
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
      <input type="range" min="0" max="${record.actions.length}" value="${startingAction}" data-replay-slider aria-label="Posición de la repetición"/>
      <button type="button" class="secondary-button" data-replay-step="1" aria-label="Posición siguiente">→</button>
    </div>
    ${
      moments.length
        ? `<div class="key-moments">${moments.map((moment) => `<button type="button" class="moment-jump" data-replay-moment="${moment.actionIndex}"><span>${moment.actionIndex}</span><strong>${escapeHtml(moment.title)}</strong><small>${moment.suggestedAlternativeLabel ? `Alternativa: ${escapeHtml(moment.suggestedAlternativeLabel)}` : escapeHtml(moment.detail)}</small></button>`).join('')}</div>`
        : ''
    }
    <div class="inline-actions"><button type="button" class="text-button replay-export" data-export-match>Exportar JSON</button><button type="button" class="secondary-button" data-branch-match>Explorar desde aquí</button></div>`;
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
  replayDock.querySelectorAll<HTMLButtonElement>('[data-replay-moment]').forEach((button) => {
    button.addEventListener('click', () => updateReplay(Number(button.dataset.replayMoment)));
  });
  replayDock.querySelector('[data-export-match]')?.addEventListener('click', exportCurrentMatch);
  replayDock.querySelector('[data-branch-match]')?.addEventListener('click', () => {
    branchFromReplay(record, Number(slider?.value ?? startingAction));
  });
  replayDock.querySelector('[data-replay-close]')?.addEventListener('click', () => closeReplay());
  updateReplay(startingAction);
  replayDock.querySelector<HTMLButtonElement>('[data-replay-close]')?.focus();
  recordTelemetry('analysis-opened', { actions: record.currentAction, moments: moments.length });
  announce('Modo análisis abierto. El tablero permanece visible.');
}

function closeReplay({ resumeClock = true }: { resumeClock?: boolean } = {}): void {
  if (!replayDock) return;
  const focusReturn = replayFocusReturn;
  if (matchRecord) state = replayForDisplay(matchRecord);
  replayDock.remove();
  replayDock = null;
  replayFocusReturn = null;
  document.body.classList.remove('replay-active');
  if (resumeClock && replayClockWasRunning && matchController && !state.outcome) {
    matchController.resumeClock(Date.now());
    matchRecord = matchController.record;
    state = matchController.store.getState().game;
    persistCurrentMatch();
  }
  replayClockWasRunning = false;
  renderedStatusKey = '';
  render();
  if (focusReturn?.isConnected) window.requestAnimationFrame(() => focusReturn.focus());
}

function branchFromReplay(record: MatchRecord, actionCount: number): void {
  let cursor = Math.max(0, Math.min(record.actions.length, Math.floor(actionCount)));
  const boardOnlyRecord = { ...record, conclusion: null };
  if (cursor > 0 && replayRecord(boardOnlyRecord, cursor).outcome) cursor -= 1;
  const now = new Date().toISOString();
  const branched: MatchRecord = {
    ...structuredClone(record),
    config: {
      ...structuredClone(record.config),
      definitionId: `analysis-branch-${Date.now()}`,
      participants: [
        { kind: 'human', name: 'Análisis Cian' },
        { kind: 'human', name: 'Análisis Ámbar' },
      ],
      options: {
        ...record.config.options,
        clockSeconds: null,
        handoffScreen: false,
        allowUndo: true,
      },
    },
    actions: structuredClone(record.actions.slice(0, cursor)),
    currentAction: cursor,
    conclusion: null,
    clock: null,
    createdAt: now,
    updatedAt: now,
  };
  replayRecord(branched);
  replayClockWasRunning = false;
  closeReplay();
  saveActiveMatch(branched);
  loadRecordIntoMatch(branched);
  recordTelemetry('analysis-branched', { fromAction: cursor });
  showToast('Rama de análisis creada. Ahora puedes probar otra orden.');
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
  if (state.outcome) {
    showToast('Usa Análisis para explorar una variante desde una partida concluida.');
    return;
  }
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
  if (
    (gameMode === 'machine' || gameMode === 'academy') &&
    matchController.record.config.participants[matchController.store.getState().game.activePlayer]
      .kind === 'machine'
  ) {
    matchController.undo();
  }

  if (matchController.record.clock) {
    matchController.switchClock(matchController.store.getState().game.activePlayer, Date.now());
  }

  matchRecord = matchController.record;
  state = matchController.store.getState().game;
  persistCurrentMatch();
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
  const id = matchRecord.config.definitionId.replace(/[^a-z0-9_-]+/gi, '-');
  downloadText(`protocolo-hexagonal-${id}.json`, serializeRecord(matchRecord));
}

async function importMatchFile(file: File): Promise<void> {
  try {
    const record = parseRecord(await file.text());
    saveActiveMatch(record);
    loadRecordIntoMatch(record);
    dialog.close();
  } catch (error) {
    showDialogError(
      error instanceof Error ? error.message : 'No se pudo importar la partida.',
      dialog.querySelector<HTMLElement>('[data-import-match]'),
    );
  }
}

function showScenarioEditorDialog(): void {
  const scenarioId = `custom-${Date.now()}`;
  const editorState = isHomeScreenActive() ? createInitialState() : state;
  const baseConfig =
    matchConfig ??
    createClassicConfig({
      mode: 'local',
      confirmation: preferences.confirmation,
      fixedBoard: true,
    });
  const template: CustomScenario = {
    version: 2,
    id: scenarioId,
    title: 'Escenario personalizado',
    summary: 'Destruye la Fortaleza rival antes de agotar el límite.',
    config: {
      ...baseConfig,
      definitionId: scenarioId,
      setup: editorState.pieces.map((piece) => ({ id: piece.id, piece })),
    },
    initialState: editorState,
    objective: { kind: 'win-in', maxPlies: 80 },
    maxPlies: 80,
    hints: ['Estudia las líneas de ataque antes de comprometer tus piezas.'],
    successText: 'Misión de laboratorio completada.',
  };
  const catalog = loadScenarioCatalog();
  openDialog(`
    <span class="eyebrow">LABORATORIO</span>
    <h2>Forja una misión</h2>
    <p>Define qué hace interesante la posición. El JSON avanzado conserva control total sobre cada unidad.</p>
    <form data-forge-form>
    <div class="forge-form">
      <label><span>Título</span><input type="text" data-forge-title value="${escapeHtml(template.title)}" maxlength="80"/></label>
      <label><span>Bando controlado</span><select data-forge-player>
        <option value="0" ${template.initialState.activePlayer === 0 ? 'selected' : ''}>Cian</option>
        <option value="1" ${template.initialState.activePlayer === 1 ? 'selected' : ''}>Ámbar</option>
      </select></label>
      <label><span>Objetivo del bando controlado</span><select data-forge-objective>
        <option value="win">Ganar la batalla</option>
        <option value="win-in" selected>Ganar dentro del límite</option>
        <option value="survive">Sobrevivir hasta el límite</option>
        <option value="protect-piece">Proteger una unidad</option>
        <option value="reach">Alcanzar una coordenada</option>
      </select></label>
      <label><span>Límite de órdenes</span><input type="number" data-forge-limit value="80" min="1" max="300"/></label>
      <label><span>Unidad del objetivo</span><input type="text" data-forge-piece placeholder="id de la unidad"/></label>
      <div class="inline-actions"><label><span>Destino q</span><input type="number" data-forge-q value="0" min="-5" max="5"/></label><label><span>Destino r</span><input type="number" data-forge-r value="0" min="-5" max="5"/></label></div>
      <label><span>Descripción</span><textarea data-forge-summary rows="2">${escapeHtml(template.summary ?? '')}</textarea></label>
      <label><span>Pistas · una por línea</span><textarea data-forge-hints rows="3">${escapeHtml(template.hints?.join('\n') ?? '')}</textarea></label>
    </div>
    <details><summary>Posición y reglas · JSON avanzado</summary><p class="dialog-note">Se validan tablero, capas, Fortalezas, identificadores y ruleset antes de jugar.</p><textarea class="scenario-editor" data-scenario-json spellcheck="false">${escapeHtml(JSON.stringify(template, null, 2))}</textarea></details>
    ${
      catalog.length
        ? `<label class="field-row"><span>Catálogo local</span><select data-catalog-choice><option value="">Seleccionar…</option>${catalog.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.title)}</option>`).join('')}</select></label>`
        : '<p class="muted-copy">El catálogo local está vacío.</p>'
    }
    <div class="dialog-error" data-dialog-error role="alert" hidden></div>
    <div class="dialog-actions">
      <button type="button" class="secondary-button" data-dialog-close>Cancelar</button>
      <button type="submit" class="confirm-button" data-save-scenario>Validar y jugar</button>
    </div>
    </form>`);
  const editor = dialog.querySelector<HTMLTextAreaElement>('[data-scenario-json]');
  const forgeForm = dialog.querySelector<HTMLFormElement>('[data-forge-form]');
  dialog
    .querySelector<HTMLSelectElement>('[data-catalog-choice]')
    ?.addEventListener('change', (event) => {
      const selected = catalog.find(
        (entry) => entry.id === (event.currentTarget as HTMLSelectElement).value,
      );
      if (selected && editor) {
        editor.value = JSON.stringify(selected, null, 2);
        populateForgeFields(selected);
      }
    });
  forgeForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const errorRegion = dialog.querySelector<HTMLElement>('[data-dialog-error]');
    if (errorRegion) {
      errorRegion.hidden = true;
      errorRegion.textContent = '';
    }
    editor?.removeAttribute('aria-invalid');
    try {
      const candidate = JSON.parse(editor?.value ?? '') as CustomScenario;
      const limit = Math.max(
        1,
        Math.min(
          300,
          Number(dialog.querySelector<HTMLInputElement>('[data-forge-limit]')?.value) || 1,
        ),
      );
      candidate.title =
        dialog.querySelector<HTMLInputElement>('[data-forge-title]')?.value.trim() ||
        candidate.title;
      candidate.summary =
        dialog.querySelector<HTMLTextAreaElement>('[data-forge-summary]')?.value.trim() ||
        candidate.summary;
      candidate.maxPlies = limit;
      candidate.hints = (
        dialog.querySelector<HTMLTextAreaElement>('[data-forge-hints]')?.value ?? ''
      )
        .split('\n')
        .map((hint) => hint.trim())
        .filter(Boolean);
      const controlledPlayer =
        dialog.querySelector<HTMLSelectElement>('[data-forge-player]')?.value === '1' ? 1 : 0;
      candidate.initialState = { ...candidate.initialState, activePlayer: controlledPlayer };
      candidate.successText ||= 'Misión de laboratorio completada.';
      candidate.objective = forgeObjective(
        dialog.querySelector<HTMLSelectElement>('[data-forge-objective]')?.value ?? 'win',
        limit,
        dialog.querySelector<HTMLInputElement>('[data-forge-piece]')?.value.trim() ?? '',
        Number(dialog.querySelector<HTMLInputElement>('[data-forge-q]')?.value) || 0,
        Number(dialog.querySelector<HTMLInputElement>('[data-forge-r]')?.value) || 0,
        controlledPlayer,
      );
      const scenario = validateCustomScenario(candidate);
      saveCustomScenario(scenario);
      dialog.close();
      startScenario(customScenarioDefinition(scenario));
      showToast(`Misión “${scenario.title}” guardada en el catálogo local.`);
    } catch (error) {
      showDialogError(
        error instanceof Error ? error.message : 'El escenario no es válido.',
        editor,
      );
    }
  });
}

function populateForgeFields(scenario: CustomScenario): void {
  const objective = scenario.objective;
  const setValue = (selector: string, value: string): void => {
    const field = dialog.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      selector,
    );
    if (field) field.value = value;
  };
  setValue('[data-forge-title]', scenario.title);
  setValue('[data-forge-player]', String(scenario.initialState.activePlayer));
  setValue('[data-forge-summary]', scenario.summary ?? '');
  setValue('[data-forge-limit]', String(scenario.maxPlies ?? 20));
  setValue('[data-forge-hints]', scenario.hints?.join('\n') ?? '');
  if (
    objective &&
    ['win', 'win-in', 'survive', 'protect-piece', 'reach'].includes(objective.kind)
  ) {
    setValue('[data-forge-objective]', objective.kind);
  }
  if (objective?.kind === 'protect-piece' || objective?.kind === 'reach') {
    setValue('[data-forge-piece]', objective.pieceId);
  }
  if (objective?.kind === 'reach') {
    setValue('[data-forge-q]', String(objective.target.q));
    setValue('[data-forge-r]', String(objective.target.r));
  }
}

function forgeObjective(
  kind: string,
  limit: number,
  pieceId: string,
  q: number,
  r: number,
  controlledPlayer: 0 | 1,
): ScenarioObjective {
  if ((kind === 'protect-piece' || kind === 'reach') && !pieceId) {
    throw new Error('Ese objetivo necesita el identificador de una unidad.');
  }
  if (kind === 'win-in') return { kind, maxPlies: limit };
  if (kind === 'survive') return { kind, plies: limit, owner: controlledPlayer };
  if (kind === 'protect-piece') return { kind, pieceId, plies: limit };
  if (kind === 'reach') return { kind, pieceId, target: { q, r } };
  return { kind: 'win' };
}

function customScenarioDefinition(scenario: CustomScenario): ScenarioDefinition {
  return {
    id: `custom:${scenario.id}`,
    title: scenario.title,
    summary: scenario.summary ?? 'Completa el objetivo creado en el Laboratorio.',
    controlledPlayer: scenario.initialState.activePlayer,
    initialState: structuredClone(scenario.initialState),
    objective: scenario.objective ?? { kind: 'win' },
    maxPlies: scenario.maxPlies,
    category: 'strategic',
    difficulty: 2,
    lesson: 'Misión creada localmente en el Laboratorio.',
    hints: scenario.hints ?? [],
    successText: scenario.successText ?? 'Misión de laboratorio completada.',
  };
}

function showDialogError(message: string, focusTarget?: HTMLElement | null): void {
  let errorRegion = dialog.querySelector<HTMLElement>('[data-dialog-error]');
  if (!errorRegion) {
    errorRegion = document.createElement('div');
    errorRegion.className = 'dialog-error';
    errorRegion.dataset.dialogError = '';
    errorRegion.setAttribute('role', 'alert');
    const actions = dialog.querySelector('.dialog-actions');
    if (actions) actions.before(errorRegion);
    else dialog.querySelector('.dialog-body')?.append(errorRegion);
  }
  errorRegion.hidden = false;
  errorRegion.textContent = message;
  if (
    focusTarget instanceof HTMLInputElement ||
    focusTarget instanceof HTMLTextAreaElement ||
    focusTarget instanceof HTMLSelectElement
  ) {
    focusTarget.setAttribute('aria-invalid', 'true');
  }
  errorRegion.scrollIntoView({ block: 'nearest' });
  focusTarget?.focus();
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

function aiDoctrineCards(selected: AiPersonality): string {
  return (['balanced', 'aggressive', 'guardian', 'ambush'] as const)
    .map((personality) => {
      const labels: Record<AiPersonality, string> = {
        balanced: 'Equilibrada',
        aggressive: 'Asaltante',
        guardian: 'Guardián',
        ambush: 'Emboscada',
      };
      return `<button type="button" class="doctrine-card ${personality === selected ? 'selected' : ''}" role="radio" aria-checked="${personality === selected}" data-ai-doctrine="${personality}"><strong>${labels[personality]}</strong><small>${escapeHtml(aiDoctrineDescription(personality))}</small></button>`;
    })
    .join('');
}

function aiDoctrineDescription(personality: AiPersonality): string {
  return {
    balanced: 'Combina material, seguridad y presión sin forzar un único plan.',
    aggressive: 'Avanza, acepta intercambios y prioriza la Fortaleza rival.',
    guardian: 'Refuerza su retaguardia y castiga ataques mal preparados.',
    ambush: 'Busca líneas aéreas, geometrías ocultas y respuestas tácticas.',
  }[personality];
}

function createMatchSeed(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0];
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes} min ${remainder ? `${remainder} s` : ''}`.trim() : `${remainder} s`;
}

function downloadText(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
    medium: 'T',
    long: 'LM',
    fast: 'E',
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
    long: `Mueve una casilla o dispara exactamente a distancia 3. ${piece.type === 'long' && (piece.missilesRemaining ?? 2) === 0 ? 'Sin misiles: puede seguir moviéndose o convertirse en Soldado.' : 'Dispone de dos misiles para toda la partida; no se recargan.'}`,
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

function requireElementBySelector<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Falta el elemento ${selector}`);
  return element;
}
