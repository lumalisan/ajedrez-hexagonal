import { chooseMachineAction, type SearchMetadata } from '../ai';
import { WorkerAiStrategy, difficultyBudget } from '../ai-strategy';
import { AudioDirector } from '../audio';
import {
  evaluateAcademyAchievements,
  evaluateMatchAchievements,
  loadAchievementProgress,
  registerAchievementMatch,
  saveAchievementProgress,
  type AchievementId,
  type AchievementProgress,
} from '../achievements';
import { createClassicConfig } from '../game-config';
import { directionBetween, equalHex } from '../hex';
import {
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
  occupancyAt,
  outcomeText,
} from '../engine';
import {
  appendAction,
  createMatchRecord,
  parseRecord,
  replayRecord,
  serializeRecord,
  setAcademySession,
} from '../match-record';
import { MatchController } from '../match-controller';
import type { UiMode } from '../match-store';
import {
  appendMatchHistory,
  clearActiveMatch,
  loadActiveMatch,
  loadAcademyProgress,
  loadAcademyRecords,
  loadPreferences,
  recordScenarioAttempt,
  removeMatchHistory,
  saveActiveMatch,
  savePreferences as persistPreferences,
} from '../match-storage';
import { recordTelemetry } from '../playtest-telemetry';
import { actionsAtHex, pieceAccessibleLabel } from '../rendering/model';
import {
  dailyScenarioForDate,
  evaluateScenarioProgress,
  nextScenarioHint,
  scenarioById,
  scenarioLessonAt,
  type ScenarioProgress,
} from '../scenarios';
import { loadScenarioCatalog, type CustomScenario } from '../scenario-catalog';
import type {
  Direction,
  GameAction,
  GameEvent,
  GameMode,
  Hex,
  MatchConfig,
  MatchRecord,
  Piece,
  ScenarioDefinition,
} from '../types';
import type {
  DialogState,
  GameCommands,
  GameRenderer,
  GameSession,
  GameSnapshot,
} from './contracts';

/** Owns one local game session. React subscribes; rules and rendering stay independent. */
export function createGameSession(): GameSession {
  const preferences = loadPreferences();
  preferences.boardDepth = false;
  preferences.tacticalThreats = false;
  preferences.contextualHints = false;
  const audio = new AudioDirector(preferences);
  const aiStrategy = new WorkerAiStrategy();
  const listeners = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const pendingDelays = new Set<() => void>();
  let renderer: GameRenderer | null = null;
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
  let replayCursor: number | null = null;
  let replayClockWasRunning = false;
  let machineThinking = false;
  let machineSearch: SearchMetadata | null = null;
  let logOpen = false;
  let homeDemoTimer: ReturnType<typeof setTimeout> | null = null;
  let homeDemoBusy = false;
  let scenarioProgress: ScenarioProgress | null = null;
  let scenarioHintsRevealed = 0;
  let scenarioAttemptsRecorded = false;
  let outcomePresentedFor = '';
  let lastClockPersistSecond = -1;
  let homeView: GameSnapshot['homeView'] = 'main';
  let currentDialog: DialogState | null = null;
  let dialogError: string | null = null;
  let announcement = '';
  let announcementId = 0;
  let nextToastId = 0;
  let toasts: GameSnapshot['toasts'] = [];
  let achievements = loadAchievementProgress();
  let achievementNotification: GameSnapshot['achievementNotification'] = null;
  let nextAchievementNotificationId = 0;
  let achievementQueue: AchievementId[] = [];
  let achievementTimer: ReturnType<typeof setTimeout> | null = null;
  let achievementStorageWarningShown = false;
  let snapshot: GameSnapshot;
  let disposed = false;
  let lifecycle: AbortController | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let operationEpoch = 0;
  let clockWasRunningBeforeDispose = false;

  function later(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delay);
    timers.add(timer);
    return timer;
  }

  function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        timers.delete(timer);
        pendingDelays.delete(finish);
        resolve();
      };
      const timer = later(finish, milliseconds);
      pendingDelays.add(finish);
    });
  }

  function render(): void {
    if (disposed) return;
    const selected = selectedId ? getPiece(state, selectedId) : undefined;
    if (selectedId && !selected) {
      selectedId = null;
      pendingAction = null;
      mode = { kind: 'default' };
    }
    const displayActions = selected
      ? selected.owner === state.activePlayer
        ? getLegalActionsForPiece(state, selected.id)
        : getPreviewActionsForPiece(state, selected.id)
      : [];
    visibleActions = filterVisibleActions(displayActions, selected);
    snapshot = {
      state,
      preferences: { ...preferences },
      selectedId,
      pendingAction,
      mode,
      hoveredHex,
      focusedHex,
      visibleActions,
      firingRange: currentFiringRange(),
      lastEvents,
      animating,
      gameMode,
      matchConfig,
      matchRecord,
      activeScenario,
      scenarioProgress,
      scenarioHintsRevealed,
      machineThinking,
      machineSearch,
      isMachineTurn: isMachineTurn(),
      viewPlayer: viewPlayer(),
      isLocalMatch: isLocalMatch(),
      canUndo: Boolean(matchController?.canUndo()),
      canRedo: Boolean(matchController?.canRedo()),
      logOpen,
      homeView,
      dialog: currentDialog,
      dialogError,
      replayCursor,
      announcement,
      announcementId,
      toasts,
      achievements,
      achievementNotification,
    };
    syncCanvas();
    for (const listener of listeners) listener();
  }

  function syncCanvas(): void {
    renderer?.setModel({
      state,
      fortressMaxHp: [fortressMaximumHp(0), fortressMaximumHp(1)],
      selectedId,
      actions: visibleActions,
      pending: pendingAction,
      hovered: hoveredHex,
      focused: focusedHex,
      firingRange: currentFiringRange(),
      lastEvents,
      threatenedCells: [],
      reducedMotion: preferences.reducedMotion,
      highContrast: preferences.highContrast,
      idleAnimations: preferences.idleAnimations && currentDialog === null,
    });
  }

  function openDialog(dialog: DialogState): void {
    closeReplay();
    currentDialog = dialog;
    dialogError = null;
    render();
  }

  function closeDialog(): void {
    currentDialog = null;
    dialogError = null;
    render();
  }

  function announce(message: string): void {
    announcement = message;
    announcementId++;
    render();
  }

  function showToast(message: string): void {
    if (disposed) return;
    const id = ++nextToastId;
    toasts = [...toasts, { id, message }];
    render();
    later(() => {
      toasts = toasts.filter((toast) => toast.id !== id);
      render();
    }, 2_800);
  }

  function showDialogError(message: string): void {
    dialogError = message;
    render();
    announce(message);
  }

  function persistAchievements(): void {
    if (!saveAchievementProgress(achievements) && !achievementStorageWarningShown) {
      achievementStorageWarningShown = true;
      showToast('Los logros seguirán activos, pero este navegador no permite guardarlos.');
    }
  }

  function showNextAchievement(): void {
    achievementTimer = null;
    if (disposed || document.visibilityState === 'hidden') return;
    const achievementId = achievementQueue.shift();
    achievementNotification = achievementId
      ? { id: ++nextAchievementNotificationId, achievementId }
      : null;
    render();
    if (!achievementId) return;
    audio.playAchievement();
    achievementTimer = later(() => {
      achievementNotification = null;
      render();
      achievementTimer = later(showNextAchievement, 250);
    }, 4_500);
  }

  function acceptAchievements(result: {
    progress: AchievementProgress;
    unlocked: AchievementId[];
  }): void {
    if (result.progress === achievements) return;
    achievements = result.progress;
    persistAchievements();
    achievementQueue.push(...result.unlocked);
    if (achievementQueue.length && !achievementNotification && achievementTimer === null)
      achievementTimer = later(showNextAchievement, 750);
    render();
  }

  function syncAcademyAchievements(completed: ReturnType<typeof recordScenarioAttempt>): void {
    acceptAchievements(
      evaluateAcademyAchievements(
        achievements,
        [...loadAcademyProgress(), completed.id],
        [
          ...loadAcademyRecords()
            .filter((record) => record.completed && record.medal === 'gold')
            .map((record) => record.id),
          ...(completed.medal === 'gold' ? [completed.id] : []),
        ],
        new Date().toISOString(),
      ),
    );
  }

  function registerCurrentAchievementMatch(): void {
    if (!matchRecord) return;
    achievements = registerAchievementMatch(achievements, matchRecord);
    persistAchievements();
  }

  // An imported record never becomes an eligible local match after a reload.
  function excludeImportedAchievements(record: MatchRecord): void {
    if (!achievements.registeredMatchIds.includes(record.createdAt)) return;
    achievements = {
      ...achievements,
      registeredMatchIds: achievements.registeredMatchIds.filter((id) => id !== record.createdAt),
    };
    persistAchievements();
  }

  function isHomeScreenActive(): boolean {
    return homeView !== null;
  }
  function leaveHomeScreen(): void {
    operationEpoch++;
    stopHomeDemo();
    homeView = null;
    currentDialog = null;
    dialogError = null;
    replayCursor = null;
    animating = false;
  }

  function showHomeScreen(view: 'main' | 'new' = 'main'): void {
    operationEpoch++;
    aiAbortController?.abort();
    aiStrategy.dispose();
    if (matchController?.record.clock && !state.outcome) {
      matchController.pauseClock(Date.now());
      matchRecord = matchController.record;
      persistCurrentMatch();
    }
    stopHomeDemo();
    homeView = view;
    currentDialog = null;
    dialogError = null;
    replayCursor = null;
    replayClockWasRunning = false;
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
    hoveredHex = null;
    animating = false;
    machineThinking = false;
    machineSearch = null;
    scenarioProgress = null;
    scenarioHintsRevealed = 0;
    scenarioAttemptsRecorded = false;
    lastClockPersistSecond = -1;
    homeDemoBusy = false;
    logOpen = false;
    renderer?.resetView();
    renderer?.snapToPlayer(0);
    render();
    startHomeDemo();
  }

  function setReplayCursor(cursor: number): void {
    if (!matchRecord || replayCursor === null) return;
    replayCursor = Math.max(0, Math.min(matchRecord.actions.length, cursor));
    state = replayForDisplay(matchRecord, replayCursor);
    selectedId = null;
    pendingAction = null;
    mode = { kind: 'default' };
    render();
  }

  function openReplay(initialAction?: number): void {
    if (!matchRecord || animating || machineThinking) return;
    currentDialog = null;
    dialogError = null;
    replayClockWasRunning = matchController?.record.clock?.status === 'running';
    if (replayClockWasRunning && matchController) {
      matchController.pauseClock(Date.now());
      matchRecord = matchController.record;
      persistCurrentMatch();
    }
    logOpen = false;
    replayCursor = 0;
    setReplayCursor(initialAction ?? matchRecord.currentAction);
    recordTelemetry('analysis-opened', { actions: matchRecord.currentAction });
    announce('Repetición abierta. El tablero permanece visible.');
  }

  function closeReplay(): void {
    if (replayCursor === null) return;
    replayCursor = null;
    if (matchRecord) state = replayForDisplay(matchRecord);
    if (replayClockWasRunning && matchController && !state.outcome) {
      matchController.resumeClock(Date.now());
      matchRecord = matchController.record;
      persistCurrentMatch();
    }
    replayClockWasRunning = false;
    render();
  }

  function revealHint(scenario: ScenarioDefinition): void {
    const reveal = nextScenarioHint(scenario, scenarioHintsRevealed);
    if (!reveal.hint) {
      showToast('Ya has revelado todas las pistas de esta misión.');
      return;
    }
    scenarioHintsRevealed = reveal.revealedCount;
    persistScenarioHints(scenario);
    recordTelemetry('academy-hint', { scenario: scenario.id, revealed: scenarioHintsRevealed });
    announce(`Pista ${scenarioHintsRevealed} de ${reveal.total}: ${reveal.hint}`);
  }

  function showScenarioSuccess(scenario: ScenarioDefinition): void {
    openDialog({ kind: 'scenario-success', scenario });
  }
  function showScenarioRetry(scenario: ScenarioDefinition, feedback: string): void {
    openDialog({ kind: 'scenario-retry', scenario, feedback });
  }
  function showScenarioBriefing(scenario: ScenarioDefinition): void {
    openDialog({ kind: 'scenario-briefing', scenario });
  }
  function showHandoffDialog(): void {
    openDialog({ kind: 'handoff' });
  }
  function showOutcomeDialog(): void {
    openDialog({ kind: 'outcome' });
  }
  function renderClockDisplay(): void {
    render();
  }

  function handleCell(hex: Hex): void {
    if (animating || isMachineTurn() || replayCursor !== null) return;
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
      cancelDraft();
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
      if (selected) cancelDraft();
      else render();
    } else if (pieces.length === 1) {
      selectPiece(pieces[0].id);
    } else {
      selectedId = null;
      logOpen = false;
      mode = { kind: 'pieceChoice', pieceIds: pieces.map((piece) => piece.id) };
      pendingAction = null;
      render();
      announce('Casilla apilada. Elige unidad de aire o suelo.');
    }
  }

  function selectPiece(pieceId: string): void {
    if (replayCursor !== null || animating || isMachineTurn()) return;
    const piece = getPiece(state, pieceId);
    if (!piece) return;
    logOpen = false;
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
    recordTelemetry('action-prepared', {
      kind: action.kind,
      ply: state.ply,
      mode: gameMode ?? 'none',
    });
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
    if (action.kind === 'move' && getPiece(state, action.pieceId)?.type === 'medium') return true;
    if (preferences.confirmation === 'quick') return action.kind === 'transform';
    const preview = applyAction(state, action);
    if (!preview.ok) return true;
    const enemy = state.activePlayer === 0 ? 1 : 0;
    const oldEnemy = state.pieces.filter((piece) => piece.owner === enemy).length;
    const newEnemy = preview.state.pieces.filter((piece) => piece.owner === enemy).length;
    return (
      newEnemy < oldEnemy ||
      preview.events.some(
        (event) => event.type === 'fortressDamage' || event.type === 'intercept',
      ) ||
      action.kind === 'transform'
    );
  }

  async function commitPending(): Promise<void> {
    if (!pendingAction || animating || isMachineTurn() || replayCursor !== null) return;
    await executeTurn(pendingAction);
  }

  async function executeTurn(action: GameAction): Promise<void> {
    if (disposed || animating || isHomeScreenActive()) return;
    const epoch = operationEpoch;
    const controller = matchController;
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
    animating = true;
    audio.playEvents(result.events, before);
    render();
    try {
      await renderer?.playEvents(result.events, before, preferences.reducedMotion);
      if (
        disposed ||
        epoch !== operationEpoch ||
        controller !== matchController ||
        isHomeScreenActive()
      )
        return;
      if (!state.outcome && !preferences.fixedBoard)
        await renderer?.rotateToPlayer(viewPlayer(), preferences.reducedMotion);
    } finally {
      if (!disposed && epoch === operationEpoch) {
        animating = false;
        render();
      }
    }

    if (disposed || epoch !== operationEpoch) return;

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
    if (disposed || !isMachineTurn() || state.outcome || animating || machineThinking) return;
    const epoch = operationEpoch;
    const controller = matchController;
    machineThinking = true;
    machineSearch = null;
    selectedId = null;
    pendingAction = null;
    mode = { kind: 'default' };
    render();
    announce('Turno de la máquina. Pensando jugada.');
    await delay(preferences.reducedMotion ? 60 : 220);
    if (
      disposed ||
      epoch !== operationEpoch ||
      controller !== matchController ||
      isHomeScreenActive()
    )
      return;
    if (!isMachineTurn() || state.outcome) {
      machineThinking = false;
      render();
      return;
    }
    aiAbortController?.abort();
    aiAbortController = new AbortController();
    const searchSignal = aiAbortController.signal;
    const participant = matchConfig?.participants[state.activePlayer];
    const difficulty = participant?.difficulty ?? 'recruit';
    const action = matchConfig
      ? await aiStrategy.chooseAction(state, matchConfig, {
          maxMs: difficultyBudget(difficulty),
          signal: searchSignal,
          onProgress: (metadata) => {
            if (
              disposed ||
              epoch !== operationEpoch ||
              searchSignal.aborted ||
              controller !== matchController
            )
              return;
            machineSearch = { ...metadata };
            render();
          },
        })
      : null;
    if (
      disposed ||
      epoch !== operationEpoch ||
      searchSignal.aborted ||
      controller !== matchController ||
      isHomeScreenActive()
    )
      return;
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
    return (
      gameMode === 'machine' && matchConfig?.participants[state.activePlayer].kind === 'machine'
    );
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
    if (
      !matchController?.record.clock ||
      state.outcome ||
      replayCursor !== null ||
      isHomeScreenActive()
    )
      return;
    const now = Date.now();
    matchController.switchClock(state.activePlayer, now);
    matchController.resumeClock(now);
    matchRecord = matchController.record;
    state = matchController.store.getState().game;
    persistCurrentMatch();
    renderClockDisplay();
  }

  function tickActiveClock(): void {
    if (
      !matchController?.record.clock ||
      isHomeScreenActive() ||
      state.outcome ||
      replayCursor !== null
    )
      return;
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
    if (!activeScenario && replayCursor === null) {
      acceptAchievements(
        evaluateMatchAchievements(achievements, matchRecord, { source: 'live', at: completedAt }),
      );
    }
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
    }
    announce(outcomeText(state.outcome));
    showOutcomeDialog();
  }

  function recordActiveScenarioAttempt(completed: boolean): void {
    if (!activeScenario || scenarioAttemptsRecorded) return;
    const elapsed = Math.max(0, state.ply - activeScenario.initialState.ply);
    const academyRecord = recordScenarioAttempt(activeScenario.id, {
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
    if (completed) syncAcademyAchievements(academyRecord);
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

  function fortressMaximumHp(player: 0 | 1): 1 | 2 | 3 {
    const configured = matchConfig?.setup.find(
      ({ piece }) => piece.type === 'fortress' && piece.owner === player,
    )?.piece;
    return configured?.type === 'fortress' ? configured.hp : 2;
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

  function isLocalMatch(): boolean {
    return (
      gameMode === 'local' &&
      !activeScenario &&
      Boolean(matchConfig?.participants.every((participant) => participant.kind === 'human'))
    );
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

  function startHomeDemo(): void {
    stopHomeDemo();
    homeDemoTimer = later(() => void runHomeDemoTurn(), 850);
  }

  function stopHomeDemo(): void {
    if (homeDemoTimer !== null) {
      clearTimeout(homeDemoTimer);
      timers.delete(homeDemoTimer);
    }
    homeDemoTimer = null;
  }

  async function runHomeDemoTurn(): Promise<void> {
    homeDemoTimer = null;
    if (disposed || !isHomeScreenActive() || homeDemoBusy) return;
    const epoch = operationEpoch;
    if (Boolean(currentDialog) || document.visibilityState === 'hidden') {
      homeDemoTimer = later(() => void runHomeDemoTurn(), 700);
      return;
    }
    if (state.outcome || state.ply >= 46) {
      state = createInitialState();
      lastEvents = [];
      renderer?.snapToPlayer(0);
      render();
    }
    const action = chooseMachineAction(state);
    if (!action) {
      state = createInitialState();
      render();
      homeDemoTimer = later(() => void runHomeDemoTurn(), 900);
      return;
    }
    const before = state;
    const result = applyAction(state, action);
    if (!result.ok) {
      homeDemoTimer = later(() => void runHomeDemoTurn(), 900);
      return;
    }
    state = result.state;
    lastEvents = result.events;
    homeDemoBusy = true;
    render();
    try {
      await renderer?.playEvents(result.events, before, preferences.reducedMotion);
    } finally {
      if (epoch === operationEpoch) homeDemoBusy = false;
    }
    if (!disposed && epoch === operationEpoch && isHomeScreenActive())
      homeDemoTimer = later(() => void runHomeDemoTurn(), 1_050);
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

  async function acceptBlockade(): Promise<void> {
    if (
      disposed ||
      !matchController ||
      state.outcome ||
      animating ||
      machineThinking ||
      replayCursor !== null
    )
      return;
    const epoch = operationEpoch;
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
      await renderer?.playEvents(result.events, before, preferences.reducedMotion);
    } finally {
      if (!disposed && epoch === operationEpoch) {
        animating = false;
        render();
      }
    }
    if (!disposed && epoch === operationEpoch) presentOutcome();
  }

  function resetGame(): void {
    operationEpoch++;
    currentDialog = null;
    dialogError = null;
    replayCursor = null;
    replayClockWasRunning = false;
    animating = false;
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
    registerCurrentAchievementMatch();
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
    renderer?.resetView();
    renderer?.snapToPlayer(viewPlayer());
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
    operationEpoch++;
    currentDialog = null;
    dialogError = null;
    replayCursor = null;
    replayClockWasRunning = false;
    animating = false;
    machineThinking = false;
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
    renderer?.resetView();
    renderer?.snapToPlayer(scenario.controlledPlayer);
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
    operationEpoch++;
    currentDialog = null;
    dialogError = null;
    replayCursor = null;
    replayClockWasRunning = false;
    animating = false;
    if (isHomeScreenActive()) leaveHomeScreen();
    aiAbortController?.abort();
    machineThinking = false;
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
    // Older local saves disabled undo by default. Enable the new local controls
    // without changing their actions or their portable record version.
    if (
      !scenarioId &&
      record.config.participants.every((participant) => participant.kind === 'human')
    ) {
      record = {
        ...record,
        config: { ...record.config, options: { ...record.config.options, allowUndo: true } },
      };
    }
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
    renderer?.resetView();
    renderer?.snapToPlayer(viewPlayer());
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
    if (animating || replayCursor !== null) return;
    if (isLocalMatch()) {
      navigateLocalHistory('undo');
      return;
    }
    if (state.outcome) {
      showToast('La partida ha concluido. Puedes revisar su desarrollo en Ver repetición.');
      return;
    }
    operationEpoch++;
    aiAbortController?.abort();
    aiStrategy.dispose();
    aiAbortController = null;
    machineThinking = false;
    machineSearch = null;

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
    mode = { kind: 'default' };
    lastEvents = [];
    closeDialog();
    renderer?.snapToPlayer(viewPlayer());
    render();
    announce('Última orden deshecha.');
  }

  function navigateLocalHistory(direction: 'undo' | 'redo'): void {
    if (!isLocalMatch() || !matchController || animating || replayCursor !== null) return;
    if (direction === 'undo' ? !matchController.canUndo() : !matchController.canRedo()) return;

    // Charge the current player before changing the cursor. Navigation preserves
    // elapsed time and must never undo a timeout reached between clock ticks.
    if (matchController.record.clock && !state.outcome) {
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

    const wasFinished = Boolean(state.outcome);
    if (direction === 'undo' ? !matchController.undo() : !matchController.redo()) return;
    matchRecord = matchController.record;
    state = matchController.store.getState().game;
    if (wasFinished) removeMatchHistory(matchRecord.createdAt);
    outcomePresentedFor = '';
    selectedId = null;
    pendingAction = null;
    mode = { kind: 'default' };
    hoveredHex = null;
    lastEvents = [];
    if (currentDialog) closeDialog();
    renderer?.snapToPlayer(viewPlayer());
    startActiveTurnClock();
    persistCurrentMatch();
    render();
    if (state.outcome) presentOutcome();
    else {
      announce(
        `${direction === 'undo' ? 'Última orden deshecha' : 'Última orden rehecha'}. Turno de ${PLAYER_NAMES[state.activePlayer]}.`,
      );
    }
  }

  function exportCurrentMatch(): void {
    if (!matchRecord) return;
    const id = matchRecord.config.definitionId.replace(/[^a-z0-9_-]+/gi, '-');
    downloadText(`protocolo-hexagonal-${id}.json`, serializeRecord(matchRecord));
  }

  async function importMatchFile(file: File): Promise<void> {
    const epoch = operationEpoch;
    try {
      const record = parseRecord(await file.text());
      if (disposed || epoch !== operationEpoch) return;
      if (animating) {
        throw new Error('Espera a que termine la animación y vuelve a importar la partida.');
      }
      saveActiveMatch(record);
      excludeImportedAchievements(record);
      loadRecordIntoMatch(record);
      closeDialog();
    } catch (error) {
      showDialogError(error instanceof Error ? error.message : 'No se pudo importar la partida.');
    }
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

  function savePreferences(): void {
    persistPreferences(preferences);
  }

  function createMatchSeed(): number {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0];
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

  const commands: GameCommands = {
    openDialog,
    closeDialog,
    showHome: showHomeScreen,
    setHomeView(view) {
      homeView = view;
      render();
    },
    abandon() {
      showHomeScreen();
      clearActiveMatch();
      render();
    },
    startMatch(config) {
      operationEpoch++;
      matchConfig = config;
      gameMode = config.participants.some((participant) => participant.kind === 'machine')
        ? 'machine'
        : 'local';
      currentDialog = null;
      dialogError = null;
      resetGame();
      if (isMachineTurn()) void runMachineTurn();
    },
    startScenario,
    resetGame,
    loadRecord(record) {
      excludeImportedAchievements(record);
      loadRecordIntoMatch(record);
    },
    continueMatch() {
      const saved = loadActiveMatch();
      if (saved.record) loadRecordIntoMatch(saved.record);
      else showToast('No hay una partida guardada que continuar.');
    },
    importMatch: importMatchFile,
    exportMatch: exportCurrentMatch,
    updatePreferences(update) {
      const wasFixed = preferences.fixedBoard;
      Object.assign(preferences, update);
      preferences.boardDepth = false;
      preferences.tacticalThreats = false;
      preferences.contextualHints = false;
      audio.setVolumes(
        preferences.masterVolume,
        preferences.musicVolume,
        preferences.effectsVolume,
      );
      audio.setEnabled(preferences.sound);
      savePreferences();
      if (wasFixed !== preferences.fixedBoard) {
        renderer?.snapToPlayer(viewPlayer());
        announce(
          preferences.fixedBoard
            ? 'Tablero fijo. Cian permanece abajo y Ámbar arriba.'
            : `Giro por turnos activado. Vista de ${PLAYER_NAMES[state.activePlayer]}.`,
        );
      }
      render();
    },
    toggleSound() {
      preferences.sound = audio.toggle();
      savePreferences();
      render();
    },
    selectPiece,
    selectHex: handleCell,
    clearSelection,
    cancelDraft,
    prepareAction: setPending,
    commitPending,
    setMode(nextMode) {
      mode = nextMode;
      pendingAction = null;
      if (nextMode.kind === 'transform' && nextMode.facing !== null && selectedId) {
        pendingAction =
          getLegalActionsForPiece(state, selectedId).find(
            (action) =>
              action.kind === 'transform' &&
              action.facing === nextMode.facing &&
              !action.to &&
              !action.attackAboveId,
          ) ?? null;
      }
      render();
    },
    hoverHex(hex) {
      if (hex && hoveredHex && equalHex(hex, hoveredHex)) return;
      if (!hex && !hoveredHex) return;
      hoveredHex = hex;
      render();
    },
    focusHex(hex) {
      focusedHex = hex;
      render();
    },
    announceCell,
    announce,
    showToast,
    setLogOpen(open) {
      logOpen = open;
      if (open) {
        selectedId = null;
        pendingAction = null;
        mode = { kind: 'default' };
      }
      render();
    },
    undo: undoLastAction,
    redo() {
      navigateLocalHistory('redo');
    },
    openReplay,
    setReplayCursor,
    closeReplay,
    resign() {
      if (
        !matchController ||
        state.outcome ||
        animating ||
        machineThinking ||
        replayCursor !== null
      )
        return;
      if (matchController.record.clock) matchController.pauseClock(Date.now());
      matchController.resign(state.activePlayer);
      matchRecord = matchController.record;
      state = matchController.store.getState().game;
      selectedId = null;
      pendingAction = null;
      mode = { kind: 'default' };
      aiAbortController?.abort();
      render();
      presentOutcome();
    },
    acceptBlockade,
    revealHint,
    readyForTurn() {
      closeDialog();
      startActiveTurnClock();
      if (isMachineTurn()) void runMachineTurn();
    },
    zoomBy(factor, x, y) {
      renderer?.zoomBy(factor, x, y);
    },
    resetView() {
      renderer?.resetView();
    },
  };

  function dispose(): void {
    if (disposed) return;
    clockWasRunningBeforeDispose = matchController?.record.clock?.status === 'running';
    if (clockWasRunningBeforeDispose && matchController) {
      matchController.pauseClock(Date.now());
      matchRecord = matchController.record;
      persistCurrentMatch();
    }
    disposed = true;
    operationEpoch++;
    lifecycle?.abort();
    lifecycle = null;
    if (clockTimer !== null) clearInterval(clockTimer);
    clockTimer = null;
    stopHomeDemo();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    achievementQueue = [];
    achievementNotification = null;
    achievementTimer = null;
    for (const finish of pendingDelays) finish();
    aiAbortController?.abort();
    aiStrategy.dispose();
    audio.setEnabled(false);
  }

  // Existing tutorial completion is recognized silently, without replaying old notifications.
  const academySync = evaluateAcademyAchievements(
    achievements,
    loadAcademyProgress(),
    loadAcademyRecords()
      .filter((record) => record.completed && record.medal === 'gold')
      .map((record) => record.id),
    new Date().toISOString(),
  );
  if (academySync.progress !== achievements) {
    achievements = academySync.progress;
    saveAchievementProgress(achievements);
  }
  render();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    commands,
    attachRenderer(nextRenderer) {
      renderer = nextRenderer;
      renderer.setDepthMode(false, true);
      renderer.snapToPlayer(viewPlayer());
      syncCanvas();
      return () => {
        if (renderer === nextRenderer) renderer = null;
      };
    },
    start() {
      if (lifecycle && !disposed) return dispose;
      const restarting = disposed;
      disposed = false;
      if (restarting) {
        machineThinking = false;
        animating = false;
        homeDemoBusy = false;
      }
      lifecycle?.abort();
      lifecycle = new AbortController();
      const activateAudio = (): void => {
        void audio.startMusic();
      };
      const options = { capture: true, signal: lifecycle.signal };
      window.addEventListener('pointerdown', activateAudio, options);
      window.addEventListener('keydown', activateAudio, options);
      window.addEventListener(
        'visibilitychange',
        () => {
          if (document.visibilityState === 'hidden') {
            if (achievementTimer !== null) {
              clearTimeout(achievementTimer);
              timers.delete(achievementTimer);
              achievementTimer = null;
            }
            if (achievementNotification) {
              achievementQueue.unshift(achievementNotification.achievementId);
              achievementNotification = null;
              render();
            }
          } else if (achievementQueue.length && achievementTimer === null) {
            showNextAchievement();
          }
        },
        options,
      );
      audio.setEnabled(preferences.sound);
      if (clockTimer !== null) clearInterval(clockTimer);
      clockTimer = setInterval(tickActiveClock, 250);
      if (isHomeScreenActive()) startHomeDemo();
      else {
        if (clockWasRunningBeforeDispose && matchController && !state.outcome) {
          matchController.resumeClock(Date.now());
          matchRecord = matchController.record;
          persistCurrentMatch();
        }
        if (isMachineTurn() && replayCursor === null && currentDialog?.kind !== 'scenario-briefing')
          void runMachineTurn();
      }
      clockWasRunningBeforeDispose = false;
      render();
      return dispose;
    },
    dispose,
  };
}
