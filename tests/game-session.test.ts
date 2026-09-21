import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiStrategy } from '../src/ai-strategy';
import type { SearchMetadata } from '../src/ai';
import type { GameRenderer, GameSession, GameSnapshot } from '../src/app/contracts';
import { createGameSession } from '../src/app/game-session';
import { getAllLegalActions } from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import { appendAction, createMatchRecord, replayRecord } from '../src/match-record';
import { loadActiveMatch, loadPreferences, saveActiveMatch } from '../src/match-storage';
import type { GameAction, GameState, MatchRecord } from '../src/types';
import { installMemoryStorage } from './helpers/memory-storage';

const collaborators = vi.hoisted(() => ({
  chooseAction: vi.fn<AiStrategy['chooseAction']>(),
  disposeAi: vi.fn(),
  startMusic: vi.fn(),
  setEnabled: vi.fn(),
  setVolumes: vi.fn(),
  chooseDemoAction: vi.fn<(state: GameState) => GameAction | null>(),
}));

vi.mock('../src/audio', () => ({
  AudioDirector: class {
    startMusic = collaborators.startMusic;
    setEnabled = collaborators.setEnabled;
    setVolumes = collaborators.setVolumes;
    playSelect = vi.fn();
    playInvalid = vi.fn();
    playEvents = vi.fn();
    playTurn = vi.fn();
    toggle = vi.fn(() => false);
  },
}));

vi.mock('../src/ai-strategy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai-strategy')>();
  return {
    ...actual,
    WorkerAiStrategy: class {
      chooseAction = collaborators.chooseAction;
      dispose = collaborators.disposeAi;
    },
  };
});

vi.mock('../src/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ai')>();
  return { ...actual, chooseMachineAction: collaborators.chooseDemoAction };
});

function rotation(state: GameState): GameAction {
  const action = getAllLegalActions(state).find((candidate) => candidate.kind === 'rotate');
  if (!action) throw new Error('La posición de prueba debe permitir una rotación.');
  return action;
}

function savedRecord(plies = 2, mode: 'local' | 'machine' = 'local'): MatchRecord {
  let record = createMatchRecord(createClassicConfig({ mode }));
  for (let ply = 0; ply < plies; ply++) {
    record = appendAction(record, rotation(replayRecord(record)));
  }
  return record;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function rendererDouble() {
  const renderer = {
    setDepthMode: vi.fn(),
    snapToPlayer: vi.fn(),
    setModel: vi.fn(),
    resetView: vi.fn(),
    zoomBy: vi.fn(),
    playEvents: vi.fn<GameRenderer['playEvents']>().mockResolvedValue(undefined),
    rotateToPlayer: vi.fn<GameRenderer['rotateToPlayer']>().mockResolvedValue(undefined),
  } satisfies GameRenderer;
  return renderer;
}

describe('sesión que conecta React con el juego', () => {
  const sessions: GameSession[] = [];
  let browserWindow: EventTarget;

  function createSession() {
    const session = createGameSession();
    sessions.push(session);
    return session;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T10:00:00.000Z'));
    vi.clearAllMocks();
    collaborators.chooseAction.mockReset().mockResolvedValue(null);
    collaborators.chooseDemoAction.mockReset().mockImplementation(rotation);
    installMemoryStorage();
    browserWindow = new EventTarget();
    vi.stubGlobal('window', browserWindow);
    vi.stubGlobal('document', { visibilityState: 'visible' });
    vi.stubGlobal('navigator', { vibrate: vi.fn() });
  });

  afterEach(() => {
    for (const session of sessions.splice(0)) session.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('continúa un guardado y publica snapshots estables para las suscripciones', () => {
    const record = savedRecord();
    saveActiveMatch(record);
    const session = createSession();
    const before = session.getSnapshot();
    const observed: GameSnapshot[] = [];
    const unsubscribe = session.subscribe(() => observed.push(session.getSnapshot()));

    expect(session.getSnapshot()).toBe(before);
    session.commands.continueMatch();

    const restored = session.getSnapshot();
    expect(restored.state).toEqual(replayRecord(record));
    expect(restored.matchRecord).toEqual(record);
    expect(restored.homeView).toBeNull();
    expect(restored.gameMode).toBe('local');
    expect(observed.at(-1)).toBe(restored);
    expect(session.getSnapshot()).toBe(restored);
    expect(before.homeView).toBe('main');
    expect(before.matchRecord).toBeNull();

    unsubscribe();
    const observedCount = observed.length;
    session.commands.setLogOpen(true);
    expect(observed).toHaveLength(observedCount);
    expect(session.getSnapshot().logOpen).toBe(true);
  });

  it('ejecuta una orden legal y deshace y rehace sin perder su continuación guardada', async () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    const initial = structuredClone(session.getSnapshot().state);
    const action = rotation(initial);

    session.commands.selectPiece(action.pieceId);
    session.commands.prepareAction(action);
    expect(session.getSnapshot().pendingAction).toEqual(action);
    await session.commands.commitPending();

    const after = structuredClone(session.getSnapshot().state);
    expect(after.ply).toBe(initial.ply + 1);
    expect(after.activePlayer).toBe(1);
    expect(session.getSnapshot().selectedId).toBeNull();
    expect(session.getSnapshot().pendingAction).toBeNull();
    expect(loadActiveMatch().record?.actions).toEqual([action]);

    session.commands.undo();
    expect(session.getSnapshot().state).toEqual(initial);
    expect(session.getSnapshot().canRedo).toBe(true);
    expect(loadActiveMatch().record).toMatchObject({ currentAction: 0, actions: [action] });

    session.commands.redo();
    expect(session.getSnapshot().state).toEqual(after);
    expect(session.getSnapshot().canRedo).toBe(false);
    expect(loadActiveMatch().record).toMatchObject({ currentAction: 1, actions: [action] });
  });

  it('rechaza una orden ilegal sin alterar la partida ni el registro', async () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    const before = structuredClone(session.getSnapshot().state);
    const persisted = loadActiveMatch().record;
    session.commands.prepareAction({ ...rotation(before), pieceId: 'unidad-inexistente' });
    await session.commands.commitPending();
    expect(session.getSnapshot().state).toEqual(before);
    expect(loadActiveMatch().record).toEqual(persisted);
    expect(session.getSnapshot().toasts.at(-1)?.message).toBeTruthy();
  });

  it('cancelar la orden conserva la unidad y permite preparar otra sin modificar la partida', () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    const before = structuredClone(session.getSnapshot().state);
    const persisted = loadActiveMatch().record;
    const action = rotation(before);
    session.commands.selectPiece(action.pieceId);
    session.commands.setMode({ kind: 'rotate' });
    session.commands.prepareAction(action);

    session.commands.cancelDraft();

    expect(session.getSnapshot()).toMatchObject({
      selectedId: action.pieceId,
      pendingAction: null,
      mode: { kind: 'default' },
      state: before,
    });
    expect(loadActiveMatch().record).toEqual(persisted);
    session.commands.prepareAction(action);
    expect(session.getSnapshot().pendingAction).toEqual(action);
  });

  it.each(['unidad seleccionada', 'casilla vacía'])(
    'pulsar %s cancela la orden sin deseleccionar la unidad',
    (target) => {
      const session = createSession();
      session.commands.startMatch(createClassicConfig({ mode: 'local' }));
      const before = structuredClone(session.getSnapshot().state);
      const piece = before.pieces.find(
        (candidate) => candidate.position.q === 0 && candidate.position.r === -2,
      );
      if (!piece) throw new Error('La posición de prueba debe contener el soldado central.');
      const move = getAllLegalActions(before).find(
        (action) => action.pieceId === piece.id && action.kind === 'move',
      );
      if (!move) throw new Error('El soldado central debe poder moverse.');
      session.commands.selectPiece(piece.id);
      session.commands.prepareAction(move);

      const hex = target === 'unidad seleccionada' ? piece.position : { q: 0, r: 0 };
      session.commands.selectHex(hex);
      session.commands.selectHex(hex);

      expect(session.getSnapshot()).toMatchObject({
        selectedId: piece.id,
        pendingAction: null,
        mode: { kind: 'default' },
        state: before,
      });
      expect(loadActiveMatch().record?.actions).toEqual([]);
    },
  );

  it('pulsar una casilla vacía conserva la elección entre unidades apiladas', () => {
    const session = createSession();
    const config = createClassicConfig({ mode: 'local' });
    const drone = config.setup.find(({ piece }) => piece.type === 'drone' && piece.owner === 0);
    if (!drone) throw new Error('La posición de prueba debe contener un dron.');
    drone.piece.position = { q: 0, r: -2 };
    session.commands.startMatch(config);
    session.commands.selectHex({ q: 0, r: -2 });
    const choice = session.getSnapshot().mode;
    expect(choice.kind).toBe('pieceChoice');

    session.commands.selectHex({ q: 0, r: 0 });

    expect(session.getSnapshot().mode).toEqual(choice);
    expect(session.getSnapshot().selectedId).toBeNull();
    expect(session.getSnapshot().state.ply).toBe(0);
  });

  it('abrir el registro cancela la selección y la orden preparada', () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    const action = rotation(session.getSnapshot().state);
    session.commands.selectPiece(action.pieceId);
    session.commands.setMode({ kind: 'rotate' });
    session.commands.prepareAction(action);

    session.commands.setLogOpen(true);
    session.commands.setLogOpen(false);

    expect(session.getSnapshot().selectedId).toBeNull();
    expect(session.getSnapshot().pendingAction).toBeNull();
    expect(session.getSnapshot().mode).toEqual({ kind: 'default' });
    expect(session.getSnapshot().state.ply).toBe(0);
  });

  it('reproduce otras posiciones y restaura la partida sin modificar su registro', () => {
    const session = createSession();
    const record = savedRecord(3);
    saveActiveMatch(record);
    session.commands.continueMatch();
    const activeState = structuredClone(session.getSnapshot().state);
    const activeRecord = structuredClone(session.getSnapshot().matchRecord);
    const persistedRecord = loadActiveMatch().record;

    session.commands.openReplay(1);
    expect(session.getSnapshot().state).toEqual(replayRecord(record, 1));
    expect(session.getSnapshot().replayCursor).toBe(1);
    session.commands.setReplayCursor(0);
    expect(session.getSnapshot().state).toEqual(record.initialState);
    session.commands.closeReplay();

    expect(session.getSnapshot().replayCursor).toBeNull();
    expect(session.getSnapshot().state).toEqual(activeState);
    expect(session.getSnapshot().matchRecord).toEqual(activeRecord);
    expect(loadActiveMatch().record).toEqual(persistedRecord);
  });

  it('pausa el reloj durante la repetición y lo reanuda desde el tiempo restante', async () => {
    const session = createSession();
    session.start();
    session.commands.startMatch(createClassicConfig({ mode: 'local', clockSeconds: 30 }));
    await vi.advanceTimersByTimeAsync(2_000);
    session.commands.openReplay();
    const remaining = session.getSnapshot().matchRecord?.clock?.remainingMs;
    expect(remaining?.[0]).toBe(28_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(session.getSnapshot().matchRecord?.clock?.remainingMs).toEqual(remaining);
    session.commands.closeReplay();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.getSnapshot().matchRecord?.clock?.remainingMs[0]).toBe(27_000);
  });

  it('abrir un diálogo desde la repetición recupera la posición de la partida activa', () => {
    const session = createSession();
    const record = savedRecord(3);
    session.commands.loadRecord(record);
    session.commands.openReplay(0);
    expect(session.getSnapshot().state).toEqual(record.initialState);

    session.commands.openDialog({ kind: 'settings' });

    expect(session.getSnapshot().dialog).toEqual({ kind: 'settings' });
    expect(session.getSnapshot().replayCursor).toBeNull();
    expect(session.getSnapshot().state).toEqual(replayRecord(record));
    expect(session.getSnapshot().matchRecord).toEqual(record);
  });

  it('la revancha cierra el resultado anterior y empieza una partida sin desenlace', () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    session.commands.resign();
    expect(session.getSnapshot().dialog?.kind).toBe('outcome');
    expect(session.getSnapshot().state.outcome).toEqual({
      type: 'win',
      winner: 1,
      reason: 'resignation',
    });

    session.commands.resetGame();

    expect(session.getSnapshot().dialog).toBeNull();
    expect(session.getSnapshot().state.outcome).toBeNull();
    expect(session.getSnapshot().state.ply).toBe(0);
    expect(session.getSnapshot().matchRecord?.conclusion).toBeNull();
    expect(session.getSnapshot().matchRecord?.actions).toEqual([]);
  });

  it('persiste las preferencias sin mutar snapshots ya entregados', () => {
    const session = createSession();
    const previous = session.getSnapshot();
    const update = {
      masterVolume: 0.42,
      musicVolume: 0.3,
      effectsVolume: 0.8,
      sound: false,
      highContrast: true,
      reducedMotion: true,
      idleAnimations: true,
      fixedBoard: false,
      handoffScreen: true,
      confirmation: 'critical' as const,
    };
    session.commands.updatePreferences(update);
    expect(session.getSnapshot().preferences).toMatchObject(update);
    expect(loadPreferences()).toMatchObject(update);
    expect(collaborators.setVolumes).toHaveBeenLastCalledWith(0.42, 0.3, 0.8);
    expect(collaborators.setEnabled).toHaveBeenLastCalledWith(false);
    expect(previous.preferences.masterVolume).toBe(0.72);
    expect(previous.preferences.highContrast).toBe(false);
    expect(previous.preferences.idleAnimations).toBe(false);
    expect(createSession().getSnapshot().preferences).toMatchObject(update);
  });

  it('activa el idle solo por preferencia y lo suspende mientras hay un diálogo', () => {
    const session = createSession();
    const renderer = rendererDouble();
    session.attachRenderer(renderer);
    const expectIdle = (idleAnimations: boolean) =>
      expect(renderer.setModel).toHaveBeenLastCalledWith(
        expect.objectContaining({ idleAnimations, reducedMotion: false }),
      );

    expectIdle(false);
    session.commands.updatePreferences({ idleAnimations: true });
    expectIdle(true);
    session.commands.openDialog({ kind: 'settings' });
    expectIdle(false);
    session.commands.closeDialog();
    expectIdle(true);
    session.commands.updatePreferences({ idleAnimations: false });
    expectIdle(false);
  });

  it('conserva las animaciones de órdenes con el idle desactivado por defecto', async () => {
    const session = createSession();
    const renderer = rendererDouble();
    session.attachRenderer(renderer);
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    const initial = structuredClone(session.getSnapshot().state);
    session.commands.prepareAction(rotation(initial));

    await session.commands.commitPending();

    expect(session.getSnapshot().preferences.idleAnimations).toBe(false);
    expect(renderer.playEvents).toHaveBeenCalledWith(expect.any(Array), initial, false);
    expect(session.getSnapshot().state.ply).toBe(initial.ply + 1);
  });

  it.each(['inicio', 'otra partida'] as const)(
    'cancela la IA al ir a %s e ignora su respuesta y progreso tardíos',
    async (destination) => {
      const search = deferred<GameAction | null>();
      collaborators.chooseAction.mockReturnValueOnce(search.promise);
      const session = createSession();
      session.commands.loadRecord(savedRecord(1, 'machine'));
      expect(session.getSnapshot().machineThinking).toBe(true);
      await vi.advanceTimersByTimeAsync(220);
      expect(collaborators.chooseAction).toHaveBeenCalledOnce();
      const [searchState, , budget] = collaborators.chooseAction.mock.calls[0];
      const nextRecord = savedRecord(2);
      if (destination === 'inicio') session.commands.showHome();
      else session.commands.loadRecord(nextRecord);

      expect(budget.signal?.aborted).toBe(true);
      const current = structuredClone(session.getSnapshot().state);
      const currentRecord = structuredClone(session.getSnapshot().matchRecord);
      const lateProgress: SearchMetadata = {
        requestedDepth: 9,
        completedDepth: 9,
        nodes: 100,
        elapsedMs: 50,
        timedOut: false,
        score: 1,
        candidatesConsidered: 10,
      };
      budget.onProgress?.(lateProgress);
      search.resolve(rotation(searchState));
      await vi.advanceTimersByTimeAsync(0);

      expect(session.getSnapshot().state).toEqual(current);
      expect(session.getSnapshot().matchRecord).toEqual(currentRecord);
      expect(session.getSnapshot().machineThinking).toBe(false);
      expect(session.getSnapshot().machineSearch).toBeNull();
      expect(session.getSnapshot().homeView).toBe(destination === 'inicio' ? 'main' : null);
    },
  );

  it('descarta el turno automático antes de iniciar la búsqueda si cambia de partida', async () => {
    const session = createSession();
    session.commands.loadRecord(savedRecord(1, 'machine'));
    const replacement = savedRecord(2);
    session.commands.loadRecord(replacement);
    await vi.advanceTimersByTimeAsync(500);
    expect(collaborators.chooseAction).not.toHaveBeenCalled();
    expect(session.getSnapshot().state).toEqual(replayRecord(replacement));
    expect(session.getSnapshot().machineThinking).toBe(false);
  });

  it('deshacer durante el retardo de la IA invalida la búsqueda aunque el humano vuelva a mover', async () => {
    const session = createSession();
    session.commands.loadRecord(savedRecord(1, 'machine'));
    await vi.advanceTimersByTimeAsync(100);

    session.commands.undo();
    expect(session.getSnapshot().state.ply).toBe(0);
    const action = rotation(session.getSnapshot().state);
    session.commands.prepareAction(action);
    await session.commands.commitPending();
    const position = session.getSnapshot().state;
    expect(position.ply).toBe(1);
    expect(session.getSnapshot().machineThinking).toBe(true);

    // The abandoned turn's 220 ms delay expires before the replacement turn's delay.
    await vi.advanceTimersByTimeAsync(120);
    expect(collaborators.chooseAction).not.toHaveBeenCalled();
    expect(session.getSnapshot().machineThinking).toBe(true);

    await vi.advanceTimersByTimeAsync(100);
    expect(collaborators.chooseAction).toHaveBeenCalledOnce();
    expect(collaborators.chooseAction.mock.calls[0][0]).toEqual(position);
    expect(session.getSnapshot().state).toEqual(position);
  });

  it('desmontar cancela demo, reloj, avisos y activación de audio', async () => {
    const session = createSession();
    const onUpdate = vi.fn();
    session.subscribe(onUpdate);
    const unmount = session.start();
    session.commands.showToast('Aviso temporal');
    browserWindow.dispatchEvent(new Event('pointerdown'));
    expect(collaborators.startMusic).toHaveBeenCalledOnce();
    unmount();
    const updates = onUpdate.mock.calls.length;
    expect(vi.getTimerCount()).toBe(0);
    browserWindow.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(collaborators.startMusic).toHaveBeenCalledOnce();
    expect(collaborators.chooseDemoAction).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledTimes(updates);
    expect(collaborators.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it('reanuda una única búsqueda al volver a montar durante el retardo del turno de la IA', async () => {
    const session = createSession();
    session.start();
    const record = savedRecord(1, 'machine');
    session.commands.loadRecord(record);
    expect(session.getSnapshot().machineThinking).toBe(true);
    session.dispose();
    expect(vi.getTimerCount()).toBe(0);

    session.start();
    await vi.advanceTimersByTimeAsync(220);

    expect(collaborators.chooseAction).toHaveBeenCalledOnce();
    expect(session.getSnapshot().state).toEqual(replayRecord(record));
    expect(session.getSnapshot().machineThinking).toBe(false);
  });

  it('una animación pendiente de la demo no vuelve a programar trabajo después de desmontar', async () => {
    const animation = deferred<void>();
    const renderer = rendererDouble();
    renderer.playEvents.mockReturnValueOnce(animation.promise);
    const session = createSession();
    session.attachRenderer(renderer);
    session.start();
    await vi.advanceTimersByTimeAsync(850);
    expect(renderer.playEvents).toHaveBeenCalledOnce();
    session.dispose();
    animation.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
