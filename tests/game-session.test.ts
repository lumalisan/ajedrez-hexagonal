import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiStrategy } from '../src/ai-strategy';
import type { SearchMetadata } from '../src/ai';
import type { GameRenderer, GameSession, GameSnapshot } from '../src/app/contracts';
import { createGameSession } from '../src/app/game-session';
import { loadAchievementProgress } from '../src/achievements';
import { getAllLegalActions } from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import {
  appendAction,
  createMatchRecord,
  parseRecord,
  replayRecord,
  serializeRecord,
} from '../src/match-record';
import { loadActiveMatch, loadPreferences, saveActiveMatch } from '../src/match-storage';
import type { GameAction, GameState, MatchRecord } from '../src/types';
import { installMemoryStorage } from './helpers/memory-storage';
import { BASIC_SCENARIOS } from '../src/scenarios';

const collaborators = vi.hoisted(() => ({
  chooseAction: vi.fn<AiStrategy['chooseAction']>(),
  disposeAi: vi.fn(),
  startMusic: vi.fn(),
  setEnabled: vi.fn(),
  setVolumes: vi.fn(),
  playAchievement: vi.fn(),
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
    playAchievement = collaborators.playAchievement;
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

  it.each(['recruit', 'tactical', 'commander', 'expert'] as const)(
    'asigna una semilla por partida y otra en la revancha para %s',
    async (difficulty) => {
      let nextSeed = 31;
      vi.stubGlobal('crypto', {
        getRandomValues: (values: Uint32Array) => {
          values[0] = nextSeed++;
          return values;
        },
      });
      const config = createClassicConfig({
        mode: 'machine',
        difficulty,
        personality: 'aggressive',
      });
      const session = createSession();
      session.commands.startMatch(config);
      const firstRecord = session.getSnapshot().matchRecord!;

      expect(firstRecord.config.participants[1].seed).toBe(31);
      expect(loadActiveMatch().record?.config.participants[1].seed).toBe(31);
      expect(config.participants[1].seed).toBeUndefined();

      session.commands.prepareAction(rotation(session.getSnapshot().state));
      await session.commands.commitPending();
      await vi.advanceTimersByTimeAsync(220);
      expect(collaborators.chooseAction).toHaveBeenCalledOnce();
      expect(collaborators.chooseAction.mock.calls[0][1].participants[1].seed).toBe(31);

      session.commands.resetGame();
      const rematch = session.getSnapshot().matchRecord!;
      expect(rematch.config.participants[1]).toEqual({
        ...config.participants[1],
        seed: 32,
      });
      expect(rematch.config.setup).toEqual(config.setup);
      expect(rematch.config.options).toEqual(config.options);
      expect(rematch.actions).toEqual([]);
      expect(loadActiveMatch().record?.config.participants[1].seed).toBe(32);
      expect(firstRecord.config.participants[1].seed).toBe(31);

      session.commands.startMatch(config);
      expect(session.getSnapshot().matchConfig?.participants[1].seed).toBe(33);
    },
  );

  it.each([0, 42])(
    'respeta la semilla explícita %s al iniciar una partida reproducible',
    (seed) => {
      const session = createSession();
      const config = createClassicConfig({ mode: 'machine', seed });
      session.commands.startMatch(config);
      expect(session.getSnapshot().matchRecord?.config.participants[1].seed).toBe(seed);
      session.commands.startMatch(config);
      expect(loadActiveMatch().record?.config.participants[1].seed).toBe(seed);
      expect(config.participants[1].seed).toBe(seed);
    },
  );

  it.each([undefined, 0, 42])(
    'conserva la semilla %s al continuar, reproducir e importar, incluidos guardados antiguos',
    async (seed) => {
      const record = savedRecord(2, 'machine');
      if (seed !== undefined) record.config.participants[1].seed = seed;
      const serialized = serializeRecord(record);
      expect(parseRecord(serialized)).toEqual(record);
      saveActiveMatch(record);
      const session = createSession();
      session.commands.continueMatch();
      expect(session.getSnapshot().matchRecord?.config.participants[1].seed).toBe(seed);

      session.commands.openReplay(0);
      session.commands.setReplayCursor(1);
      session.commands.closeReplay();
      expect(session.getSnapshot().matchRecord?.config.participants[1].seed).toBe(seed);
      expect(loadActiveMatch().record?.config.participants[1].seed).toBe(seed);

      await session.commands.importMatch({ text: async () => serialized } as File);
      expect(session.getSnapshot().matchRecord).toEqual(record);
      expect(loadActiveMatch().record?.config.participants[1].seed).toBe(seed);
    },
  );

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

  it.each([null, 30])(
    'salir conserva la posición y las órdenes deshechas para continuar (reloj: %s)',
    async (clockSeconds) => {
      const session = createSession();
      session.start();
      session.commands.startMatch(
        createClassicConfig({
          mode: 'local',
          clockSeconds,
          turnClockSeconds: clockSeconds === null ? null : 5,
        }),
      );
      for (let turn = 0; turn < 2; turn++) {
        session.commands.prepareAction(rotation(session.getSnapshot().state));
        await session.commands.commitPending();
      }
      const afterRedo = structuredClone(session.getSnapshot().state);
      session.commands.undo();
      await vi.advanceTimersByTimeAsync(2_000);
      const beforeExit = structuredClone(session.getSnapshot());

      browserWindow.addEventListener('click', session.commands.abandon, { once: true });
      browserWindow.dispatchEvent(new Event('click'));

      expect(session.getSnapshot().homeView).toBe('main');
      expect(session.getSnapshot().matchRecord).toBeNull();
      const saved = loadActiveMatch().record;
      expect(saved).toMatchObject({
        currentAction: 1,
        actions: beforeExit.matchRecord!.actions,
        conclusion: null,
      });
      expect(replayRecord(saved!)).toEqual(beforeExit.state);
      if (clockSeconds !== null) {
        expect(saved?.clock).toMatchObject({
          status: 'paused',
          lastTickAt: null,
          remainingMs: [30_000, 28_000],
          turnRemainingMs: 3_000,
        });
      }
      await vi.advanceTimersByTimeAsync(10_000);
      expect(loadActiveMatch().record).toEqual(saved);
      session.dispose();

      const resumed = createSession();
      resumed.start();
      resumed.commands.continueMatch();
      expect(resumed.getSnapshot().homeView).toBeNull();
      expect(resumed.getSnapshot().state).toEqual(beforeExit.state);
      expect(resumed.getSnapshot().canRedo).toBe(true);
      if (clockSeconds !== null) {
        expect(resumed.getSnapshot().matchRecord?.clock).toMatchObject({
          status: 'running',
          remainingMs: saved!.clock!.remainingMs,
          turnRemainingMs: 3_000,
        });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(resumed.getSnapshot().matchRecord?.clock).toMatchObject({
          remainingMs: [30_000, 27_000],
          turnRemainingMs: 2_000,
        });
      }
      resumed.commands.redo();
      expect(resumed.getSnapshot().state).toEqual(afterRedo);
    },
  );

  it('salir después de rendirse mantiene la partida terminada sin continuación', () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local', clockSeconds: 30 }));
    session.commands.resign();
    expect(session.getSnapshot().state.outcome).toEqual({
      type: 'win',
      winner: 1,
      reason: 'resignation',
    });

    session.commands.abandon();

    expect(session.getSnapshot().homeView).toBe('main');
    expect(loadActiveMatch().record).toBeNull();
    session.commands.continueMatch();
    expect(session.getSnapshot().homeView).toBe('main');
    expect(session.getSnapshot().matchRecord).toBeNull();
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

  it.each([
    ['unidad seleccionada', false],
    ['casilla vacía', false],
    ['unidad seleccionada', true],
    ['casilla vacía', true],
  ])(
    'pulsar %s deselecciona sin modificar la partida (orden preparada: %s)',
    (target, prepared) => {
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
      if (prepared) session.commands.prepareAction(move);

      const hex = target === 'unidad seleccionada' ? piece.position : { q: 0, r: 0 };
      session.commands.selectHex(hex);

      expect(session.getSnapshot()).toMatchObject({
        selectedId: null,
        pendingAction: null,
        mode: { kind: 'default' },
        focusedHex: hex,
        visibleActions: [],
        state: before,
      });
      expect(loadActiveMatch().record?.actions).toEqual([]);
    },
  );

  it.each(['unidad seleccionada', 'casilla vacía'])(
    'pulsar %s también deselecciona una unidad rival inspeccionada',
    (target) => {
      const session = createSession();
      session.commands.startMatch(createClassicConfig({ mode: 'local' }));
      const before = structuredClone(session.getSnapshot().state);
      const rival = before.pieces.find((piece) => piece.owner !== before.activePlayer)!;
      session.commands.selectHex(rival.position);
      expect(session.getSnapshot().selectedId).toBe(rival.id);

      session.commands.selectHex(
        target === 'unidad seleccionada' ? rival.position : { q: 0, r: 0 },
      );

      expect(session.getSnapshot()).toMatchObject({
        selectedId: null,
        pendingAction: null,
        visibleActions: [],
        state: before,
      });
    },
  );

  it('pulsar un destino legal prepara la orden y repetirlo la confirma', () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    const before = structuredClone(session.getSnapshot().state);
    session.commands.selectHex({ q: 0, r: -2 });
    const selectedId = session.getSnapshot().selectedId;
    const destination = { q: 0, r: -1 };

    session.commands.selectHex(destination);

    expect(session.getSnapshot()).toMatchObject({
      selectedId,
      pendingAction: { kind: 'move', pieceId: selectedId, to: destination },
      state: before,
    });
    const action = session.getSnapshot().pendingAction;
    session.commands.selectHex(destination);

    expect(session.getSnapshot().state.ply).toBe(before.ply + 1);
    expect(loadActiveMatch().record?.actions).toEqual([action]);
  });

  it('mantiene la confirmación de una rotación preparada sobre la propia casilla', () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    const before = structuredClone(session.getSnapshot().state);
    const action = rotation(before);
    const piece = before.pieces.find((candidate) => candidate.id === action.pieceId)!;
    session.commands.selectPiece(piece.id);
    session.commands.setMode({ kind: 'rotate' });
    session.commands.prepareAction(action);

    session.commands.selectHex(piece.position);

    expect(session.getSnapshot().state.ply).toBe(before.ply + 1);
    expect(loadActiveMatch().record?.actions).toEqual([action]);
  });

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

  it('abrir y cerrar el registro conserva la selección y la orden preparada', () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    const action = rotation(session.getSnapshot().state);
    session.commands.selectPiece(action.pieceId);
    session.commands.setMode({ kind: 'rotate' });
    session.commands.prepareAction(action);

    session.commands.setLogOpen(true);
    expect(session.getSnapshot().logOpen).toBe(true);
    expect(session.getSnapshot().selectedId).toBe(action.pieceId);
    expect(session.getSnapshot().pendingAction).toEqual(action);
    session.commands.setLogOpen(false);

    expect(session.getSnapshot().selectedId).toBe(action.pieceId);
    expect(session.getSnapshot().pendingAction).toEqual(action);
    expect(session.getSnapshot().mode).toEqual({ kind: 'rotate' });
    expect(session.getSnapshot().state.ply).toBe(0);
  });

  it('mantiene el registro abierto al elegir una unidad apilada y ejecutar su orden', async () => {
    const session = createSession();
    const config = createClassicConfig({ mode: 'local' });
    const drone = config.setup.find(({ piece }) => piece.type === 'drone' && piece.owner === 0);
    if (!drone) throw new Error('La posición de prueba debe contener un dron.');
    drone.piece.position = { q: 0, r: -2 };
    session.commands.startMatch(config);
    session.commands.setLogOpen(true);
    session.commands.selectHex({ q: 0, r: -2 });
    expect(session.getSnapshot().mode.kind).toBe('pieceChoice');
    expect(session.getSnapshot().logOpen).toBe(true);
    // Alternar el registro tampoco debe cancelar la elección de capa.
    const choice = session.getSnapshot().mode;
    session.commands.setLogOpen(false);
    session.commands.setLogOpen(true);
    expect(session.getSnapshot().mode).toEqual(choice);
    const soldier = session
      .getSnapshot()
      .state.pieces.find(
        (piece) => piece.type === 'soldier' && piece.position.q === 0 && piece.position.r === -2,
      )!;
    session.commands.selectPiece(soldier.id);
    expect(session.getSnapshot().logOpen).toBe(true);
    const action = getAllLegalActions(session.getSnapshot().state).find(
      (candidate) => candidate.kind === 'rotate' && candidate.pieceId === soldier.id,
    )!;
    session.commands.prepareAction(action);
    await session.commands.commitPending();
    expect(session.getSnapshot().logOpen).toBe(true);
    expect(session.getSnapshot().state.history.at(-1)?.text).toContain('giró');
    expect(session.getSnapshot().state.ply).toBe(1);
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

  it.each([null, 300])(
    'reanuda ambos límites desde el guardado sin contar tiempo offline (total %s)',
    async (total) => {
      const session = createSession();
      session.start();
      session.commands.startMatch(
        createClassicConfig({ mode: 'local', clockSeconds: total, turnClockSeconds: 30 }),
      );
      await vi.advanceTimersByTimeAsync(4_000);
      const saved = loadActiveMatch().record!;
      expect(saved.clock?.turnRemainingMs).toBe(26_000);
      session.dispose();
      await vi.advanceTimersByTimeAsync(60_000);

      const resumed = createSession();
      resumed.start();
      resumed.commands.loadRecord(saved);
      expect(resumed.getSnapshot().state.outcome).toBeNull();
      expect(resumed.getSnapshot().matchRecord?.clock?.turnRemainingMs).toBe(26_000);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(resumed.getSnapshot().matchRecord?.clock?.turnRemainingMs).toBe(25_000);
      expect(loadActiveMatch().record?.clock?.turnRemainingMs).toBe(25_000);
    },
  );

  it('pausa ambos límites en repetición y reinicia el turno al cambiar de jugador', async () => {
    const session = createSession();
    session.start();
    session.commands.startMatch(
      createClassicConfig({ mode: 'local', clockSeconds: 300, turnClockSeconds: 30 }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    session.commands.openReplay();
    await vi.advanceTimersByTimeAsync(60_000);
    session.commands.closeReplay();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.getSnapshot().matchRecord?.clock).toMatchObject({
      remainingMs: [297_000, 300_000],
      turnRemainingMs: 27_000,
    });
    session.commands.prepareAction(rotation(session.getSnapshot().state));
    await session.commands.commitPending();
    expect(session.getSnapshot().matchRecord?.clock).toMatchObject({
      activePlayer: 1,
      remainingMs: [297_000, 300_000],
      turnRemainingMs: 30_000,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    session.commands.undo();
    expect(session.getSnapshot().matchRecord?.clock).toMatchObject({
      activePlayer: 0,
      remainingMs: [297_000, 295_000],
      turnRemainingMs: 30_000,
    });
    session.commands.redo();
    expect(session.getSnapshot().matchRecord?.clock).toMatchObject({
      activePlayer: 1,
      remainingMs: [297_000, 295_000],
      turnRemainingMs: 30_000,
    });
  });

  it('renueva el turno cuando el rival pasa automáticamente sin acciones legales', async () => {
    const session = createSession();
    session.start();
    const config = createClassicConfig({ mode: 'local', clockSeconds: 300, turnClockSeconds: 30 });
    const soldier = config.setup.find(
      ({ piece }) => piece.owner === 0 && piece.type === 'soldier',
    )!;
    config.setup = config.setup.filter(
      ({ piece }) => piece.type === 'fortress' || piece.id === soldier.id,
    );
    session.commands.startMatch(config);
    await vi.advanceTimersByTimeAsync(29_000);
    session.commands.prepareAction(rotation(session.getSnapshot().state));

    await session.commands.commitPending();

    expect(session.getSnapshot().lastEvents).toContainEqual({ type: 'pass', owner: 1 });
    expect(session.getSnapshot().state).toMatchObject({ activePlayer: 0, ply: 1, outcome: null });
    expect(session.getSnapshot().matchRecord?.clock).toMatchObject({
      activePlayer: 0,
      remainingMs: [271_000, 300_000],
      turnRemainingMs: 30_000,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(session.getSnapshot().state.outcome).toBeNull();
    expect(session.getSnapshot().matchRecord?.clock?.turnRemainingMs).toBe(28_000);
  });

  it('cobra el reloj una sola vez al aceptar una orden justo antes del límite', async () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local', turnClockSeconds: 30 }));
    session.commands.prepareAction(rotation(session.getSnapshot().state));
    const committedAt = Date.now() + 29_999;
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(committedAt)
      .mockReturnValue(committedAt + 2);
    try {
      await session.commands.commitPending();
      expect(session.getSnapshot().state).toMatchObject({ activePlayer: 1, ply: 1, outcome: null });
      expect(session.getSnapshot().matchRecord?.clock).toMatchObject({
        status: 'running',
        activePlayer: 1,
        turnRemainingMs: 30_000,
      });
    } finally {
      now.mockRestore();
    }
  });

  it('suspende ambos límites durante la animación y el relevo', async () => {
    const session = createSession();
    session.start();
    session.commands.startMatch(
      createClassicConfig({
        mode: 'local',
        clockSeconds: 300,
        turnClockSeconds: 30,
        handoffScreen: true,
      }),
    );
    session.commands.updatePreferences({ handoffScreen: true });
    const renderer = rendererDouble();
    const animation = deferred<void>();
    renderer.playEvents.mockReturnValue(animation.promise);
    session.attachRenderer(renderer);
    await vi.advanceTimersByTimeAsync(2_000);
    session.commands.prepareAction(rotation(session.getSnapshot().state));
    const committed = session.commands.commitPending();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(session.getSnapshot().matchRecord?.clock).toMatchObject({
      status: 'paused',
      activePlayer: 1,
      remainingMs: [298_000, 300_000],
      turnRemainingMs: 30_000,
    });
    animation.resolve();
    await committed;
    expect(session.getSnapshot().dialog?.kind).toBe('handoff');
    await vi.advanceTimersByTimeAsync(40_000);
    session.commands.readyForTurn();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(session.getSnapshot().matchRecord?.clock).toMatchObject({
      status: 'running',
      activePlayer: 1,
      remainingMs: [298_000, 297_000],
      turnRemainingMs: 27_000,
    });
  });

  it('la IA juega los dos primeros turnos agotados de cada jugador y el tercero termina la partida', async () => {
    collaborators.chooseAction.mockImplementation(async (state) => rotation(state));
    const session = createSession();
    session.start();
    session.commands.startMatch(createClassicConfig({ mode: 'local', turnClockSeconds: 30 }));
    expect(session.getSnapshot().matchRecord?.clock?.turnTimeouts).toEqual([0, 0]);

    for (let expiration = 1; expiration <= 4; expiration++) {
      const before = structuredClone(session.getSnapshot().state);
      await vi.advanceTimersByTimeAsync(30_500);
      expect(collaborators.chooseAction).toHaveBeenCalledTimes(expiration);
      expect(collaborators.chooseAction.mock.calls[expiration - 1][0]).toEqual(before);
      expect(session.getSnapshot().state).toMatchObject({
        activePlayer: expiration % 2,
        ply: expiration,
        outcome: null,
      });
      expect(session.getSnapshot().matchRecord?.actions.at(-1)).toEqual(rotation(before));
      expect(session.getSnapshot().matchRecord?.clock).toMatchObject({
        status: 'running',
        turnTimeouts: [Math.ceil(expiration / 2), Math.floor(expiration / 2)],
      });
    }

    await vi.advanceTimersByTimeAsync(30_500);
    const outcome = { type: 'win', winner: 1, reason: 'timeout' };
    expect(session.getSnapshot().state.outcome).toEqual(outcome);
    expect(session.getSnapshot().dialog?.kind).toBe('outcome');
    expect(session.getSnapshot().matchRecord?.clock?.turnTimeouts).toEqual([3, 2]);
    expect(session.getSnapshot().matchRecord?.actions).toHaveLength(4);
    expect(collaborators.chooseAction).toHaveBeenCalledTimes(4);
    const portable = parseRecord(serializeRecord(session.getSnapshot().matchRecord!));
    expect(replayRecord(portable).outcome).toEqual(outcome);
    session.commands.undo();
    expect(session.getSnapshot().state.outcome).toEqual(outcome);
  });

  it.each([null, 30])(
    'agotar el tiempo total termina la partida sin autojugada (límite de turno: %s)',
    async (turnClockSeconds) => {
      const session = createSession();
      session.start();
      session.commands.startMatch(
        createClassicConfig({ mode: 'local', clockSeconds: 30, turnClockSeconds }),
      );
      await vi.advanceTimersByTimeAsync(30_500);

      expect(session.getSnapshot().state.outcome).toEqual({
        type: 'win',
        winner: 1,
        reason: 'timeout',
      });
      expect(session.getSnapshot().dialog?.kind).toBe('outcome');
      expect(session.getSnapshot().matchRecord?.actions).toEqual([]);
      expect(collaborators.chooseAction).not.toHaveBeenCalled();
    },
  );

  it('vacía la orden preparada y bloquea la elección humana durante la autojugada pendiente', async () => {
    const search = deferred<GameAction | null>();
    collaborators.chooseAction.mockReturnValueOnce(search.promise);
    const session = createSession();
    session.start();
    session.commands.startMatch(
      createClassicConfig({ mode: 'local', clockSeconds: 300, turnClockSeconds: 30 }),
    );
    const before = structuredClone(session.getSnapshot().state);
    const action = rotation(before);
    session.commands.selectPiece(action.pieceId);
    session.commands.setMode({ kind: 'rotate' });
    session.commands.prepareAction(action);

    await vi.advanceTimersByTimeAsync(30_500);

    expect(session.getSnapshot()).toMatchObject({
      state: before,
      selectedId: null,
      pendingAction: null,
      mode: { kind: 'default' },
      isMachineTurn: true,
      machineThinking: true,
      matchRecord: { clock: { status: 'turn-expired', turnTimeouts: [1, 0] } },
    });
    session.commands.selectPiece(action.pieceId);
    session.commands.setMode({ kind: 'rotate' });
    session.commands.prepareAction(action);
    await session.commands.commitPending();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(session.getSnapshot().selectedId).toBeNull();
    expect(session.getSnapshot().pendingAction).toBeNull();
    expect(session.getSnapshot().mode).toEqual({ kind: 'default' });
    expect(session.getSnapshot().state).toEqual(before);
    expect(session.getSnapshot().matchRecord?.clock?.turnTimeouts).toEqual([1, 0]);
    expect(collaborators.chooseAction).toHaveBeenCalledOnce();

    search.resolve(action);
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().state).toMatchObject({ activePlayer: 1, ply: 1, outcome: null });
    expect(session.getSnapshot().isMachineTurn).toBe(false);
    expect(session.getSnapshot().matchRecord?.clock).toMatchObject({
      status: 'running',
      activePlayer: 1,
      turnRemainingMs: 30_000,
      turnTimeouts: [1, 0],
    });
  });

  it('la IA sustituye una orden humana que llega después del límite aunque aún no haya tick', async () => {
    collaborators.chooseAction.mockImplementation(async (state) => rotation(state));
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local', turnClockSeconds: 30 }));
    const before = structuredClone(session.getSnapshot().state);
    const humanAction = getAllLegalActions(before).find((action) => action.kind === 'move');
    if (!humanAction) throw new Error('La posición de prueba debe permitir un movimiento.');
    session.commands.prepareAction(humanAction);
    vi.setSystemTime(Date.now() + 30_001);

    await session.commands.commitPending();

    expect(session.getSnapshot().state).toEqual(before);
    expect(session.getSnapshot().pendingAction).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(session.getSnapshot().matchRecord?.actions).toEqual([rotation(before)]);
    expect(session.getSnapshot().state).toMatchObject({ activePlayer: 1, ply: 1, outcome: null });
    expect(session.getSnapshot().matchRecord?.clock?.turnTimeouts).toEqual([1, 0]);
    expect(collaborators.chooseAction).toHaveBeenCalledOnce();
  });

  it('deshacer contra la máquina después del límite humano conserva la posición y ejecuta su autojugada', async () => {
    const search = deferred<GameAction | null>();
    collaborators.chooseAction.mockReturnValueOnce(search.promise);
    let record = createMatchRecord(createClassicConfig({ mode: 'machine', turnClockSeconds: 30 }));
    for (let ply = 0; ply < 2; ply++) {
      record = appendAction(record, rotation(replayRecord(record)));
    }
    const session = createSession();
    session.commands.loadRecord(record);
    const before = structuredClone(session.getSnapshot().state);
    expect(before).toMatchObject({ activePlayer: 0, ply: 2 });
    expect(session.getSnapshot().canUndo).toBe(true);
    vi.setSystemTime(Date.now() + 30_001);

    session.commands.undo();

    expect(session.getSnapshot().state).toEqual(before);
    expect(session.getSnapshot().matchRecord?.actions).toEqual(record.actions);
    expect(session.getSnapshot().matchRecord?.currentAction).toBe(2);
    expect(session.getSnapshot().matchRecord?.clock).toMatchObject({
      status: 'turn-expired',
      turnTimeouts: [1, 0],
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(collaborators.chooseAction).toHaveBeenCalledOnce();
    expect(collaborators.chooseAction.mock.calls[0][0]).toEqual(before);

    search.resolve(rotation(before));
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().state).toMatchObject({ activePlayer: 1, ply: 3, outcome: null });
    expect(session.getSnapshot().matchRecord?.actions).toEqual([
      ...record.actions,
      rotation(before),
    ]);
    expect(session.getSnapshot().matchRecord?.clock?.turnTimeouts).toEqual([1, 0]);
  });

  it.each(['sin resultado', 'error'] as const)(
    'resuelve el turno agotado con una acción legal si la IA devuelve %s',
    async (failure) => {
      if (failure === 'error')
        collaborators.chooseAction.mockRejectedValueOnce(new Error('Worker no disponible'));
      const session = createSession();
      session.start();
      session.commands.startMatch(createClassicConfig({ mode: 'local', turnClockSeconds: 30 }));
      const legalActions = getAllLegalActions(session.getSnapshot().state);

      await vi.advanceTimersByTimeAsync(30_500);

      const record = session.getSnapshot().matchRecord!;
      expect(record.actions).toHaveLength(1);
      expect(legalActions).toContainEqual(record.actions[0]);
      expect(session.getSnapshot().state).toMatchObject({ activePlayer: 1, ply: 1, outcome: null });
      expect(record.clock).toMatchObject({ status: 'running', turnTimeouts: [1, 0] });
    },
  );

  it('continuar un turno agotado guardado reanuda una sola autojugada sin sumar otra falta', async () => {
    const abandonedSearch = deferred<GameAction | null>();
    collaborators.chooseAction
      .mockReturnValueOnce(abandonedSearch.promise)
      .mockImplementation(async (state) => rotation(state));
    const session = createSession();
    session.start();
    session.commands.startMatch(createClassicConfig({ mode: 'local', turnClockSeconds: 30 }));
    const before = structuredClone(session.getSnapshot().state);
    await vi.advanceTimersByTimeAsync(30_500);
    expect(collaborators.chooseAction).toHaveBeenCalledOnce();
    session.dispose();
    const saved = parseRecord(serializeRecord(loadActiveMatch().record!));
    expect(saved.clock).toMatchObject({ status: 'turn-expired', turnTimeouts: [1, 0] });
    expect(saved.actions).toEqual([]);
    saveActiveMatch(saved);

    const resumed = createSession();
    resumed.start();
    resumed.commands.continueMatch();
    await vi.advanceTimersByTimeAsync(500);
    abandonedSearch.resolve(rotation(before));
    await vi.advanceTimersByTimeAsync(500);

    expect(collaborators.chooseAction).toHaveBeenCalledTimes(2);
    expect(resumed.getSnapshot().state).toMatchObject({ activePlayer: 1, ply: 1, outcome: null });
    expect(resumed.getSnapshot().matchRecord?.actions).toEqual([rotation(before)]);
    expect(resumed.getSnapshot().matchRecord?.clock).toMatchObject({
      status: 'running',
      turnTimeouts: [1, 0],
    });
    expect(loadActiveMatch().record?.actions).toEqual([rotation(before)]);
  });

  it.each(['otra partida', 'desmontar'] as const)(
    'descarta la autojugada por tiempo y su progreso tardío al ir a %s',
    async (destination) => {
      const search = deferred<GameAction | null>();
      collaborators.chooseAction.mockReturnValueOnce(search.promise);
      const session = createSession();
      session.start();
      session.commands.startMatch(createClassicConfig({ mode: 'local', turnClockSeconds: 30 }));
      await vi.advanceTimersByTimeAsync(30_500);
      expect(collaborators.chooseAction).toHaveBeenCalledOnce();
      const [searchState, , budget] = collaborators.chooseAction.mock.calls[0];
      if (destination === 'otra partida')
        session.commands.startMatch(createClassicConfig({ mode: 'local' }));
      else session.dispose();
      const current = structuredClone(session.getSnapshot().state);
      const currentRecord = structuredClone(session.getSnapshot().matchRecord);
      const saved = loadActiveMatch().record;

      expect(budget.signal?.aborted).toBe(true);
      budget.onProgress?.({
        requestedDepth: 3,
        completedDepth: 3,
        nodes: 100,
        elapsedMs: 50,
        timedOut: false,
        score: 1,
        candidatesConsidered: 10,
      });
      search.resolve(rotation(searchState));
      await vi.advanceTimersByTimeAsync(500);

      expect(session.getSnapshot().state).toEqual(current);
      expect(session.getSnapshot().matchRecord).toEqual(currentRecord);
      expect(session.getSnapshot().machineSearch).toBeNull();
      expect(loadActiveMatch().record).toEqual(saved);
      expect(collaborators.chooseAction).toHaveBeenCalledOnce();
    },
  );

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

  it('guarda los logros de una partida real y presenta cada aviso una sola vez', async () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local', clockSeconds: 300 }));
    session.commands.prepareAction(rotation(session.getSnapshot().state));
    await session.commands.commitPending();
    session.commands.resign();

    const earned = session.getSnapshot().achievements;
    const unlockedCount = Object.keys(earned.unlockedAt).length;
    expect(earned.counters.matches).toBe(1);
    expect(earned.counters.wins).toBe(1);
    expect(unlockedCount).toBeGreaterThan(1);
    expect(loadAchievementProgress()).toEqual(earned);
    expect(session.getSnapshot().achievementNotification).toBeNull();

    await vi.advanceTimersByTimeAsync(750);
    expect(session.getSnapshot().achievementNotification).not.toBeNull();
    expect(collaborators.playAchievement).toHaveBeenCalledTimes(1);
    const first = session.getSnapshot().achievementNotification;
    await vi.advanceTimersByTimeAsync(4_750);
    expect(session.getSnapshot().achievementNotification?.achievementId).not.toBe(
      first?.achievementId,
    );
    expect(collaborators.playAchievement).toHaveBeenCalledTimes(2);

    session.commands.openReplay(0);
    session.commands.closeReplay();
    expect(session.getSnapshot().achievements).toEqual(earned);
    await vi.advanceTimersByTimeAsync(unlockedCount * 4_750);
    expect(session.getSnapshot().achievementNotification).toBeNull();
    expect(collaborators.playAchievement).toHaveBeenCalledTimes(unlockedCount);
    expect(createSession().getSnapshot().achievements).toEqual(earned);
  });

  it('continúa contando una partida local guardada tras recrear la sesión', async () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    session.commands.prepareAction(rotation(session.getSnapshot().state));
    await session.commands.commitPending();
    session.dispose();
    const resumed = createSession();
    resumed.commands.continueMatch();
    resumed.commands.resign();
    expect(resumed.getSnapshot().achievements.counters.matches).toBe(1);
  });

  it('desbloquea al transformar, antes de acabar la animación, y conserva el logro al abandonar', async () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    const animation = deferred<void>();
    const renderer = rendererDouble();
    renderer.playEvents.mockReturnValue(animation.promise);
    session.attachRenderer(renderer);
    const transform = getAllLegalActions(session.getSnapshot().state).find(
      (action) => action.kind === 'transform',
    );
    expect(transform).toBeDefined();
    session.commands.prepareAction(transform!);
    expect(session.getSnapshot().achievements.counters.transformations).toBe(0);
    expect(collaborators.playAchievement).not.toHaveBeenCalled();

    const committed = session.commands.commitPending();
    const earned = session.getSnapshot().achievements;
    expect(session.getSnapshot().state.outcome).toBeNull();
    expect(earned.counters).toMatchObject({ transformations: 1, matches: 0, wins: 0 });
    expect(earned.unlockedAt.transformation).toBeDefined();
    expect(loadAchievementProgress()).toEqual(earned);
    await vi.advanceTimersByTimeAsync(750);
    expect(session.getSnapshot().achievementNotification?.achievementId).toBe('transformation');
    expect(collaborators.playAchievement).toHaveBeenCalledTimes(1);

    animation.resolve();
    await committed;
    session.commands.abandon();
    session.dispose();
    expect(createSession().getSnapshot().achievements).toEqual(earned);
  });

  it('no vuelve a sumar ni avisar al repetir una acción deshecha o terminar la partida', async () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    const transform = getAllLegalActions(session.getSnapshot().state).find(
      (action) => action.kind === 'transform',
    );
    expect(transform).toBeDefined();
    session.commands.prepareAction(transform!);
    await session.commands.commitPending();
    await vi.advanceTimersByTimeAsync(5_500);
    expect(collaborators.playAchievement).toHaveBeenCalledTimes(1);
    session.commands.undo();
    session.dispose();

    const resumed = createSession();
    resumed.commands.continueMatch();
    resumed.commands.redo();
    resumed.commands.undo();
    resumed.commands.prepareAction(transform!);
    await resumed.commands.commitPending();
    await vi.advanceTimersByTimeAsync(750);
    expect(resumed.getSnapshot().achievements.counters.transformations).toBe(1);
    expect(resumed.getSnapshot().achievementNotification).toBeNull();
    expect(collaborators.playAchievement).toHaveBeenCalledTimes(1);
    resumed.commands.resign();
    expect(resumed.getSnapshot().achievements.counters).toMatchObject({
      transformations: 1,
      matches: 1,
    });
  });

  it('las acciones de una importación no desbloquean logros instantáneos', async () => {
    const session = createSession();
    session.commands.loadRecord(savedRecord(0));
    const transform = getAllLegalActions(session.getSnapshot().state).find(
      (action) => action.kind === 'transform',
    );
    expect(transform).toBeDefined();
    session.commands.prepareAction(transform!);
    await session.commands.commitPending();
    await vi.advanceTimersByTimeAsync(750);
    expect(session.getSnapshot().achievements.counters.transformations).toBe(0);
    expect(session.getSnapshot().achievementNotification).toBeNull();
    expect(collaborators.playAchievement).not.toHaveBeenCalled();
  });

  it('una importación pendiente no gana logros al terminarla, ni tras recargarla', async () => {
    const session = createSession();
    session.commands.loadRecord(savedRecord());
    session.commands.prepareAction(rotation(session.getSnapshot().state));
    await session.commands.commitPending();
    session.dispose();
    const resumed = createSession();
    resumed.commands.continueMatch();
    resumed.commands.resign();
    expect(resumed.getSnapshot().achievements.counters.matches).toBe(0);
    expect(resumed.getSnapshot().achievementNotification).toBeNull();
    expect(collaborators.playAchievement).not.toHaveBeenCalled();
  });

  it('reimportar una partida propia no conserva su autorización para sumar logros', async () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    session.commands.prepareAction(rotation(session.getSnapshot().state));
    await session.commands.commitPending();
    const exported = session.getSnapshot().matchRecord!;
    expect(session.getSnapshot().achievements.registeredMatchIds).toContain(exported.createdAt);
    await session.commands.importMatch({
      text: async () => JSON.stringify(exported),
    } as File);
    expect(session.getSnapshot().achievements.registeredMatchIds).not.toContain(exported.createdAt);
    session.dispose();
    const resumed = createSession();
    resumed.commands.continueMatch();
    resumed.commands.resign();
    expect(resumed.getSnapshot().achievements.counters.matches).toBe(0);
  });

  it('completar el tutorial actualiza logros; repetirlo no multiplica el progreso', async () => {
    const session = createSession();
    const scenario = BASIC_SCENARIOS[0];
    const completeLesson = async () => {
      session.commands.startScenario(scenario);
      session.commands.closeDialog();
      const move = getAllLegalActions(session.getSnapshot().state).find(
        (action) => action.kind === 'move' && action.pieceId === 'academy-soldier',
      );
      expect(move).toBeDefined();
      session.commands.prepareAction(move!);
      await session.commands.commitPending();
    };
    await completeLesson();
    const earned = session.getSnapshot().achievements;
    expect(earned.completedScenarioIds).toContain(scenario.id);
    expect(Object.keys(earned.unlockedAt).length).toBeGreaterThan(0);
    await completeLesson();
    expect(session.getSnapshot().achievements).toEqual(earned);
  });

  it('pospone los avisos en segundo plano y los cancela al desmontar', async () => {
    const session = createSession();
    session.start();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    session.commands.prepareAction(rotation(session.getSnapshot().state));
    await session.commands.commitPending();
    session.commands.resign();
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    browserWindow.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.getSnapshot().achievementNotification).toBeNull();
    expect(collaborators.playAchievement).not.toHaveBeenCalled();
    vi.stubGlobal('document', { visibilityState: 'visible' });
    browserWindow.dispatchEvent(new Event('visibilitychange'));
    expect(session.getSnapshot().achievementNotification).not.toBeNull();
    expect(collaborators.playAchievement).toHaveBeenCalledTimes(1);
    session.dispose();
    await vi.advanceTimersByTimeAsync(30_000);
    session.start();
    expect(session.getSnapshot().achievementNotification).toBeNull();
    expect(collaborators.playAchievement).toHaveBeenCalledTimes(1);
  });

  it('conserva los logros de Academia en memoria si falla el almacenamiento', async () => {
    const session = createSession();
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Almacenamiento no disponible');
    });
    session.commands.startScenario(BASIC_SCENARIOS[0]);
    session.commands.closeDialog();
    const move = getAllLegalActions(session.getSnapshot().state).find(
      (action) => action.kind === 'move' && action.pieceId === 'academy-soldier',
    );
    expect(move).toBeDefined();
    session.commands.prepareAction(move!);
    await session.commands.commitPending();
    expect(session.getSnapshot().achievements.completedScenarioIds).toContain('movement');
    expect(session.getSnapshot().achievements.unlockedAt['academy-first']).toBeDefined();
    await vi.advanceTimersByTimeAsync(750);
    expect(session.getSnapshot().achievementNotification?.achievementId).toBe('academy-first');
    expect(session.getSnapshot().toasts.some((toast) => toast.message.includes('logros'))).toBe(
      true,
    );
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
