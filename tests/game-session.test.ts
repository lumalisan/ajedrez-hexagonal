import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiStrategy } from '../src/ai-strategy';
import type { SearchMetadata } from '../src/ai';
import type { GameRenderer, GameSession, GameSnapshot } from '../src/app/contracts';
import { createGameSession } from '../src/app/game-session';
import { MatchController } from '../src/match-controller';
import { loadAchievementProgress } from '../src/achievements';
import { createPlayerProgression, savePlayerProgression, xpForLevel } from '../src/progression';
import { getAllLegalActions } from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import { createInitialPieces } from '../src/setup';
import {
  appendAction,
  createMatchRecord,
  parseRecord,
  replayRecord,
  serializeRecord,
} from '../src/match-record';
import {
  loadActiveMatch,
  loadMatchHistory,
  loadPreferences,
  saveActiveMatch,
} from '../src/match-storage';
import type { GameAction, GameState, MatchRecord } from '../src/types';
import { installMemoryStorage } from './helpers/memory-storage';
import { BASIC_SCENARIOS } from '../src/scenarios';
import type { OnlineClient, OnlineState } from '../src/online-contracts';

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

  it('pide una cuenta antes de abrir el menú en línea y conserva la pantalla del invitado', () => {
    let registered = false;
    const onAccountRequired = vi.fn();
    const request = vi.fn<OnlineClient['request']>();
    const session = createGameSession({
      onlineClient: { request },
      publicOnlineAllowed: () => registered,
      onAccountRequired,
    });
    sessions.push(session);
    session.commands.setHomeView('new');
    session.commands.openDialog({ kind: 'online' });
    expect(onAccountRequired).toHaveBeenCalledOnce();
    expect(session.getSnapshot().dialog).toBeNull();
    expect(session.getSnapshot().homeView).toBe('new');
    expect(request).not.toHaveBeenCalled();
    session.commands.openDialog({ kind: 'mode' });
    session.commands.openDialog({ kind: 'online' });
    expect(session.getSnapshot().dialog).toEqual({ kind: 'mode' });
    registered = true;
    session.commands.openDialog({ kind: 'online' });
    expect(session.getSnapshot().dialog).toEqual({ kind: 'online' });
  });

  it('busca directamente, ignora los filtros guardados y permite cancelar durante la conexión inicial', async () => {
    localStorage.setItem(
      'hexfortia-online-search-v1',
      JSON.stringify({ turnSeconds: [90], layouts: [5] }),
    );
    const response = deferred<OnlineState>();
    const request = vi
      .fn<OnlineClient['request']>()
      .mockReturnValueOnce(response.promise)
      .mockResolvedValue({ status: 'idle' });
    const session = createGameSession({ onlineClient: { request } });
    sessions.push(session);
    session.commands.startOnlineSearch();
    session.commands.startOnlineSearch();
    expect(session.getSnapshot().dialog).toEqual({ kind: 'online-search' });
    expect(session.getSnapshot().online.busy).toBe(true);
    session.commands.closeDialog();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toEqual({
      kind: 'search',
      name: session.getSnapshot().profile.name,
    });
    response.resolve({ status: 'searching', joinedAt: Date.now(), elo: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.map(([operation]) => operation.kind)).toEqual(['search', 'cancel']);
    expect(session.getSnapshot().online.state.status).toBe('idle');
    expect(session.getSnapshot().dialog).toBeNull();
  });

  it('permite salir de la búsqueda cuando no hay servidor configurado', async () => {
    const session = createGameSession({ onlineClient: null });
    sessions.push(session);
    session.commands.startOnlineSearch();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().online.error).toBeTruthy();
    session.commands.cancelOnlineWaiting();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().dialog).toEqual({ kind: 'online' });
  });

  it('cancela al cerrar si se perdió la respuesta inicial y la reserva puede seguir en el servidor', async () => {
    const request = vi
      .fn<OnlineClient['request']>()
      .mockRejectedValueOnce(new Error('Sin conexión'))
      .mockResolvedValue({ status: 'idle' });
    const session = createGameSession({ onlineClient: { request } });
    sessions.push(session);
    session.commands.startOnlineSearch();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().online.error).toBe('Sin conexión');
    session.commands.closeDialog();
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.map(([operation]) => operation.kind)).toEqual(['search', 'cancel']);
    expect(session.getSnapshot().dialog).toBeNull();
  });

  it('ignora respuestas en línea después de dispose y cancela la petición', async () => {
    const response = deferred<OnlineState>();
    const request = vi.fn<OnlineClient['request']>().mockReturnValue(response.promise);
    const session = createGameSession({ onlineClient: { request } });
    sessions.push(session);
    session.commands.startOnlineSearch();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledOnce();
    const signal = request.mock.calls[0][1];
    session.dispose();
    response.resolve({ status: 'searching', joinedAt: Date.now(), elo: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(signal.aborted).toBe(true);
    expect(session.getSnapshot().online.state.status).toBe('idle');
  });

  it('solo confirma órdenes recibidas del servidor y fija la perspectiva del jugador en línea', async () => {
    const config = createClassicConfig({ mode: 'local' });
    config.options.allowUndo = false;
    config.definitionId = 'online:ranked:test';
    const record = createMatchRecord(config);
    const response: OnlineState = {
      status: 'playing',
      matchId: 'match',
      player: 1,
      revision: 0,
      record,
      elo: 1120,
      serverNow: Date.now(),
    };
    const request = vi.fn<OnlineClient['request']>().mockResolvedValue(response);
    const session = createGameSession({ onlineClient: { request } });
    sessions.push(session);
    session.commands.startOnlineSearch();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().gameMode).toBe('online');
    expect(session.getSnapshot().viewPlayer).toBe(1);
    expect(session.getSnapshot().isLocalMatch).toBe(false);
    expect(session.getSnapshot().canUndo).toBe(false);
    expect(session.getSnapshot().progression.ratings.online).toBe(1120);
    session.commands.prepareAction(rotation(session.getSnapshot().state));
    await session.commands.commitPending();
    expect(session.getSnapshot().matchRecord?.currentAction).toBe(0);
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([0, 1] as const)(
    'registra estadísticas, logros y XP de una privada para el jugador %s sin alterar Elo',
    async (player) => {
      const config = createClassicConfig({ mode: 'local' });
      config.definitionId = 'online:private:test';
      const record = createMatchRecord(config);
      const response: OnlineState = {
        status: 'playing',
        matchId: 'match',
        player,
        revision: 0,
        record,
        elo: 1000,
        serverNow: Date.now(),
      };
      const request = vi.fn<OnlineClient['request']>().mockResolvedValue(response);
      const session = createGameSession({ onlineClient: { request } });
      sessions.push(session);
      session.commands.startOnlineSearch();
      await vi.advanceTimersByTimeAsync(0);
      const controller = new MatchController(record);
      controller.resign(player === 0 ? 1 : 0);
      request.mockResolvedValue({ ...response, record: controller.record, revision: 1 });
      session.commands.resumeOnline();
      await vi.advanceTimersByTimeAsync(0);
      const result = session.getSnapshot();
      expect(result.progression.matches[record.createdAt]).toMatchObject({
        mode: 'online',
        result: 1,
        rated: false,
      });
      expect(result.progression.matches[record.createdAt].battle?.rewards).toContainEqual({
        label: 'Victoria en línea',
        xp: 100,
      });
      expect(result.progression.ratings.online).toBe(1000);
      expect(result.achievements.counters).toMatchObject({ matches: 1, wins: 1, localMatches: 0 });
      session.commands.resumeOnline();
      await vi.advanceTimersByTimeAsync(0);
      expect(session.getSnapshot().progression.xp).toBe(result.progression.xp);
      expect(session.getSnapshot().achievements.counters.matches).toBe(1);
    },
  );

  it('envía propuestas al servidor y permite aceptar o rechazar la propuesta del rival', async () => {
    const config = createClassicConfig({ mode: 'local' });
    config.definitionId = 'online:private:test';
    const record = createMatchRecord(config);
    const response: OnlineState = {
      status: 'playing',
      matchId: 'match',
      player: 1,
      revision: 0,
      record,
      elo: 1000,
      serverNow: Date.now(),
      drawOffer: null,
    };
    const request = vi.fn<OnlineClient['request']>().mockResolvedValue(response);
    const session = createGameSession({ onlineClient: { request } });
    sessions.push(session);
    session.commands.startOnlineSearch();
    await vi.advanceTimersByTimeAsync(0);
    session.commands.offerDraw();
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.at(-1)?.[0]).toEqual({
      kind: 'offer-draw',
      matchId: 'match',
      revision: 0,
    });
    request.mockResolvedValue({ ...response, revision: 1, drawOffer: 0 });
    session.commands.resumeOnline();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().dialog?.kind).toBe('blockade');
    session.commands.closeDialog();
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.at(-1)?.[0]).toEqual({
      kind: 'respond-draw',
      matchId: 'match',
      revision: 1,
      accept: false,
    });
    request.mockResolvedValue({ ...response, revision: 2, drawOffer: null });
    session.commands.resumeOnline();
    await vi.advanceTimersByTimeAsync(0);
    request.mockResolvedValue({ ...response, revision: 3, drawOffer: 0 });
    session.commands.resumeOnline();
    await vi.advanceTimersByTimeAsync(0);
    await session.commands.acceptBlockade();
    expect(request.mock.calls.at(-1)?.[0]).toEqual({
      kind: 'respond-draw',
      matchId: 'match',
      revision: 3,
      accept: true,
    });
    expect(session.getSnapshot().state.outcome).toBeNull();
  });

  it.each(['searching', 'private-waiting'] as const)(
    'encola una sola cancelación durante una consulta pendiente en %s',
    async (status) => {
      const waiting: OnlineState =
        status === 'searching'
          ? { status, joinedAt: Date.now(), elo: 1000 }
          : { status, code: '123456', expiresAt: Date.now() + 600_000 };
      const poll = deferred<OnlineState>();
      const request = vi
        .fn<OnlineClient['request']>()
        .mockResolvedValueOnce(waiting)
        .mockReturnValueOnce(poll.promise)
        .mockResolvedValue({ status: 'idle' });
      const session = createGameSession({ onlineClient: { request } });
      sessions.push(session);
      session.commands.resumeOnline();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(session.getSnapshot().online.busy).toBe(true);
      session.commands.cancelOnlineWaiting();
      session.commands.cancelOnlineWaiting();
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls[1][1].aborted).toBe(false);
      poll.resolve(waiting);
      await vi.advanceTimersByTimeAsync(0);
      expect(request.mock.calls.map(([operation]) => operation.kind)).toEqual([
        'state',
        'state',
        'cancel',
      ]);
      expect(session.getSnapshot().online.state.status).toBe('idle');
    },
  );

  it('descarta la cancelación encolada si la consulta pendiente encuentra una partida', async () => {
    const poll = deferred<OnlineState>();
    const request = vi
      .fn<OnlineClient['request']>()
      .mockResolvedValueOnce({ status: 'searching', joinedAt: Date.now(), elo: 1000 })
      .mockReturnValueOnce(poll.promise);
    const session = createGameSession({ onlineClient: { request } });
    sessions.push(session);
    session.commands.openDialog({ kind: 'online-search' });
    session.commands.startOnlineSearch();
    await vi.advanceTimersByTimeAsync(1_000);
    session.commands.cancelOnlineWaiting();
    session.commands.closeDialog();
    const config = createClassicConfig({ mode: 'local' });
    config.options.allowUndo = false;
    const record = createMatchRecord(config);
    poll.resolve({
      status: 'playing',
      matchId: 'found',
      player: 0,
      revision: 0,
      record,
      elo: 1000,
      serverNow: Date.now(),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.map(([operation]) => operation.kind)).toEqual(['search', 'state']);
    expect(session.getSnapshot().gameMode).toBe('online');
    expect(session.getSnapshot().online.state.status).toBe('playing');
    expect(session.getSnapshot().state.outcome).toBeNull();
    expect(session.getSnapshot().homeView).toBeNull();
  });

  it('conserva el emparejamiento si el servidor encuentra rival antes de procesar cancelar', async () => {
    const record = createMatchRecord(createClassicConfig({ mode: 'local' }));
    const request = vi
      .fn<OnlineClient['request']>()
      .mockResolvedValueOnce({ status: 'searching', joinedAt: Date.now(), elo: 1000 })
      .mockResolvedValueOnce({
        status: 'playing',
        matchId: 'race',
        player: 1,
        revision: 0,
        record,
        elo: 1000,
        serverNow: Date.now(),
      });
    const session = createGameSession({ onlineClient: { request } });
    sessions.push(session);
    session.commands.openDialog({ kind: 'online-search' });
    session.commands.startOnlineSearch();
    await vi.advanceTimersByTimeAsync(0);
    session.commands.closeDialog();
    await vi.advanceTimersByTimeAsync(0);
    expect(request.mock.calls.map(([operation]) => operation.kind)).toEqual(['search', 'cancel']);
    expect(session.getSnapshot().online.state.status).toBe('playing');
    expect(session.getSnapshot().gameMode).toBe('online');
    expect(session.getSnapshot().state.outcome).toBeNull();
    expect(session.getSnapshot().homeView).toBeNull();
  });

  it.each(['continue', 'import'] as const)(
    'desactiva la triple repetición en un guardado pendiente al cargarlo por %s',
    async (source) => {
      const config = createClassicConfig({ mode: 'local' });
      config.victory.repetition = 3;
      config.options.orientationOnlyTurnLimit = null;
      let record = createMatchRecord(config);
      const soldiers = [0, 1].map((owner) =>
        record.initialState.pieces.find((p) => p.owner === owner && p.type === 'soldier')!,
      );
      const cycle: GameAction[] = [
        { kind: 'rotate', pieceId: soldiers[0].id, facing: 1 },
        { kind: 'rotate', pieceId: soldiers[1].id, facing: 4 },
        { kind: 'rotate', pieceId: soldiers[0].id, facing: 0 },
        { kind: 'rotate', pieceId: soldiers[1].id, facing: 3 },
      ];
      // Stop before the third occurrence so this remains a pending legacy match.
      for (let ply = 0; ply < 4; ply++) record = appendAction(record, cycle[ply]);
      expect(replayRecord(record).outcome).toBeNull();
      const session = createSession();
      if (source === 'continue') {
        saveActiveMatch(record);
        session.commands.continueMatch();
      } else {
        session.commands.loadRecord(record);
      }
      expect(session.getSnapshot().matchConfig?.victory.repetition).toBe(0);
      expect(record.config.victory.repetition).toBe(3);
      for (let ply = 4; ply < 12; ply++) {
        session.commands.prepareAction(cycle[ply % 4]);
        await session.commands.commitPending();
      }
      expect(session.getSnapshot().state.ply).toBe(12);
      expect(session.getSnapshot().state.outcome).toBeNull();
      const restored = parseRecord(serializeRecord(session.getSnapshot().matchRecord!));
      expect(restored.config.victory.repetition).toBe(0);
      expect(replayRecord(restored).outcome).toBeNull();

      // A completed historical draw must retain its original result on import.
      for (let ply = 4; ply < 12 && !replayRecord(record).outcome; ply++) {
        record = appendAction(record, cycle[ply % 4]);
      }
      const historicalOutcome = { type: 'draw', reason: 'repetition' };
      expect(replayRecord(record).outcome).toEqual(historicalOutcome);
      session.commands.loadRecord(parseRecord(serializeRecord(record)));
      expect(session.getSnapshot().state.outcome).toEqual(historicalOutcome);
      expect(session.getSnapshot().matchConfig?.victory.repetition).toBe(3);
    },
  );

  it.each([0, 1] as const)(
    'sortea el turno %i antes de activar reloj o IA y conserva el resultado',
    async (winner) => {
      vi.stubGlobal('crypto', {
        getRandomValues: (values: Uint32Array) => {
          values[0] = winner;
          return values;
        },
      });
      const session = createSession();
      session.start();
      session.commands.startMatch(
        createClassicConfig({ mode: 'machine', openingDraw: true, clockSeconds: 300 }),
      );
      const initial = session.getSnapshot();
      expect(initial.dialog).toEqual({ kind: 'first-turn', player: winner });
      expect(initial.state.activePlayer).toBe(winner);
      session.commands.closeDialog();
      session.commands.openDialog({ kind: 'settings' });
      await vi.advanceTimersByTimeAsync(5000);
      expect(session.getSnapshot().dialog?.kind).toBe('first-turn');
      expect(collaborators.chooseAction).not.toHaveBeenCalled();
      expect(session.getSnapshot().matchRecord?.clock?.remainingMs).toEqual([300000, 300000]);
      expect(session.getSnapshot().matchRecord?.activeDurationMs).toBe(0);
      expect(
        replayRecord(parseRecord(serializeRecord(session.getSnapshot().matchRecord!))).activePlayer,
      ).toBe(winner);
      session.commands.finishOpeningDraw();
      expect(session.getSnapshot().dialog).toBeNull();
      expect(session.getSnapshot().matchRecord?.clock?.status).toBe('running');
      await vi.advanceTimersByTimeAsync(300);
      expect(collaborators.chooseAction).toHaveBeenCalledTimes(winner);
    },
  );

  it.each(['local', 'machine'] as const)(
    'suma solo tiempo jugado al guardar y retomar en %s',
    (mode) => {
      const session = createSession();
      session.commands.startMatch(createClassicConfig({ mode }));
      const id = session.getSnapshot().matchRecord!.createdAt;
      vi.setSystemTime(Date.now() + 60_000);
      session.commands.abandon();
      expect(loadActiveMatch().record?.activeDurationMs).toBe(60_000);
      vi.setSystemTime(Date.now() + 8 * 3_600_000);
      session.commands.continueMatch(id);
      vi.setSystemTime(Date.now() + 30_000);
      session.commands.resign();
      expect(loadMatchHistory()[0].durationSeconds).toBe(90);
      expect(session.getSnapshot().matchRecord?.activeDurationMs).toBe(90_000);
    },
  );

  it('guarda duración sin reloj al cerrar y no cuenta el tiempo con la sesión desmontada', () => {
    const session = createSession();
    session.start();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    vi.setSystemTime(Date.now() + 20_000);
    session.dispose();
    expect(loadActiveMatch().record?.activeDurationMs).toBe(20_000);
    vi.setSystemTime(Date.now() + 8 * 3_600_000);
    session.start();
    vi.setSystemTime(Date.now() + 10_000);
    session.commands.resign();
    expect(loadMatchHistory()[0].durationSeconds).toBe(30);
  });

  it('excluye el tiempo con la pestaña oculta y en repetición', () => {
    const session = createSession();
    session.start();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    vi.setSystemTime(Date.now() + 10_000);
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    browserWindow.dispatchEvent(new Event('visibilitychange'));
    vi.setSystemTime(Date.now() + 3_600_000);
    vi.stubGlobal('document', { visibilityState: 'visible' });
    browserWindow.dispatchEvent(new Event('visibilitychange'));
    vi.setSystemTime(Date.now() + 10_000);
    session.commands.openReplay();
    vi.setSystemTime(Date.now() + 3_600_000);
    session.commands.closeReplay();
    vi.setSystemTime(Date.now() + 10_000);
    session.commands.resign();
    expect(loadMatchHistory()[0].durationSeconds).toBe(30);
  });

  it('anuncia el ascenso de categoría una sola vez al obtener XP', async () => {
    const progress = createPlayerProgression();
    progress.xp = xpForLevel(5) - 25;
    progress.activity = { lastDay: '2026-09-20', streak: 2, best: 2 };
    savePlayerProgression(progress);
    const session = createSession();
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().toasts.map((toast) => toast.message)).toContain(
      '¡Has subido de categoría! Principiante → Avanzado.',
    );
    session.dispose();
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(
      session.getSnapshot().toasts.filter((toast) => toast.message.includes('categoría')),
    ).toHaveLength(1);
  });

  it('registra actividad al montar y conserva el aviso después del ciclo de Strict Mode', async () => {
    const progress = createPlayerProgression();
    progress.activity = { lastDay: '2026-09-20', streak: 2, best: 2 };
    savePlayerProgression(progress);
    createSession(); // A discarded initializer must not consume the daily achievement.
    const session = createSession();
    session.start();
    session.dispose();
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().progression.activity.streak).toBe(3);
    expect(session.getSnapshot().progression.unlockedAt['p1-15']).toBeDefined();
    expect(session.getSnapshot().progression.xp).toBe(25);
    await vi.advanceTimersByTimeAsync(750);
    expect(session.getSnapshot().achievementNotification?.achievementId).toBe('p1-15');
    expect(collaborators.playAchievement).toHaveBeenCalledTimes(1);
  });

  it.each(['recruit', 'tactical', 'commander', 'expert', 'neural'] as const)(
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
      if (!piece) throw new Error('La posición de prueba debe contener el asaltador central.');
      const move = getAllLegalActions(before).find(
        (action) => action.pieceId === piece.id && action.kind === 'move',
      );
      if (!move) throw new Error('El asaltador central debe poder moverse.');
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

  it.each(['rotate', 'orient', 'medium', 'fast', 'long'] as const)(
    'deselecciona al pulsar la propia casilla con una orden preparada de %s',
    (kind) => {
      const session = createSession();
      session.commands.startMatch(createClassicConfig({ mode: 'local' }));
      const before = structuredClone(session.getSnapshot().state);
      const action = getAllLegalActions(before).find((candidate) => {
        if (kind === 'rotate' || kind === 'orient') return candidate.kind === kind;
        return (
          candidate.kind === 'transform' &&
          !candidate.to &&
          !candidate.attackAboveId &&
          before.pieces.find((piece) => piece.id === candidate.pieceId)?.type === kind
        );
      })!;
      expect(action).toBeDefined();
      const piece = before.pieces.find((candidate) => candidate.id === action.pieceId)!;
      session.commands.selectPiece(piece.id);
      session.commands.prepareAction(action);
      session.commands.selectHex(piece.position);
      expect(session.getSnapshot()).toMatchObject({
        state: before,
        selectedId: null,
        pendingAction: null,
        mode: { kind: 'default' },
      });
      expect(loadActiveMatch().record?.actions).toEqual([]);
    },
  );

  it('guarda en el historial un registro completo con el resultado terminal', () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    session.commands.resign();
    const entry = loadMatchHistory()[0];
    expect(entry?.record).toBeDefined();
    const restored = parseRecord(serializeRecord(entry!.record!));
    expect(replayRecord(restored).outcome).toEqual(session.getSnapshot().state.outcome);
    session.commands.openHistoryReplay(restored);
    session.commands.setReplayCursor(restored.actions.length);
    expect(session.getSnapshot().state.outcome).toEqual(entry?.outcome);
  });

  it('reproduce un registro histórico y recupera la partida en curso sin sobrescribirla', () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    const previous = session.getSnapshot();
    const saved = loadActiveMatch().record;
    const record = savedRecord(2);
    session.commands.openHistoryReplay(record);
    expect(session.getSnapshot()).toMatchObject({
      replayCursor: 0,
      matchRecord: record,
      homeView: null,
      dialog: null,
    });
    session.commands.setReplayCursor(2);
    expect(session.getSnapshot().state).toEqual(replayRecord(record));
    expect(loadActiveMatch().record).toEqual(saved);
    session.commands.closeReplay();
    expect(session.getSnapshot()).toMatchObject({
      state: previous.state,
      matchRecord: previous.matchRecord,
      replayCursor: null,
      dialog: { kind: 'history' },
    });
  });

  it('regresa al historial del inicio después de una repetición', () => {
    const session = createSession();
    session.commands.openHistoryReplay(savedRecord(1));
    expect(session.getSnapshot().homeView).toBeNull();
    session.commands.closeReplay();
    expect(session.getSnapshot()).toMatchObject({
      homeView: 'main',
      matchRecord: null,
      replayCursor: null,
      dialog: { kind: 'history' },
    });
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
    expect(session.getSnapshot().state.passedTurnCount).toBe(1);
    expect(
      replayRecord(parseRecord(serializeRecord(session.getSnapshot().matchRecord!)))
        .passedTurnCount,
    ).toBe(1);
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

  it('vacía la orden preparada y permite inspección sin órdenes durante la autojugada pendiente', async () => {
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
    expect(session.getSnapshot().selectedId).toBe(action.pieceId);
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

  it('muestra solo el perfil local del invitado sin consultar al servidor', () => {
    const rankingClient = vi.fn();
    const session = createGameSession({ publicOnlineAllowed: () => false, rankingClient });
    sessions.push(session);
    session.commands.openDialog({ kind: 'ranking' });
    for (const mode of ['machine', 'online'] as const) {
      session.commands.loadRanking({ mode, period: 'all', page: 2 });
      const { ranking, profile } = session.getSnapshot();
      expect(ranking).toMatchObject({
        shared: false,
        busy: false,
        error: null,
        query: { mode, period: 'all', page: 0 },
      });
      expect(ranking.data?.entries).toEqual([
        expect.objectContaining({ name: profile.name, position: 0, played: 0 }),
      ]);
    }
    expect(rankingClient).not.toHaveBeenCalled();
  });

  it('descarta clasificaciones anteriores al cambiar filtros, cerrar o destruir la sesión', async () => {
    const requests: Array<{
      resolve: (page: import('../src/ranking-contracts').RankingPage) => void;
      signal: AbortSignal;
      query: import('../src/ranking-contracts').RankingQuery;
    }> = [];
    const session = createGameSession({
      publicOnlineAllowed: () => true,
      rankingClient: (query, signal) =>
        new Promise((resolve) => requests.push({ query, signal, resolve })),
    });
    sessions.push(session);
    const finish = (index: number) =>
      requests[index]!.resolve({ ...requests[index]!.query, total: 0, pageSize: 50, entries: [] });
    session.commands.openDialog({ kind: 'ranking' });
    expect(session.getSnapshot().ranking.busy).toBe(true);
    session.commands.loadRanking({ mode: 'machine', period: 'all', page: 0 });
    expect(requests[0]!.signal.aborted).toBe(true);
    finish(0);
    await Promise.resolve();
    expect(session.getSnapshot().ranking.data).toBeNull();
    finish(1);
    await Promise.resolve();
    expect(session.getSnapshot().ranking.data?.mode).toBe('machine');
    session.commands.loadRanking();
    session.commands.closeDialog();
    expect(requests[2]!.signal.aborted).toBe(true);
    finish(2);
    await Promise.resolve();
    expect(session.getSnapshot().ranking.data).toBeNull();
    session.commands.openDialog({ kind: 'ranking' });
    session.dispose();
    expect(requests[3]!.signal.aborted).toBe(true);
    finish(3);
    await Promise.resolve();
    expect(session.getSnapshot().ranking.data).toBeNull();
  });

  it('vuelve al resultado al cerrar clasificación o repetición y al abandonarla', () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'local' }));
    session.commands.resign();
    const outcome = session.getSnapshot().state.outcome;
    session.commands.openDialog({ kind: 'ranking' });
    session.commands.closeDialog();
    expect(session.getSnapshot().dialog?.kind).toBe('outcome');
    session.commands.openReplay(0);
    expect(session.getSnapshot().dialog).toBeNull();
    session.commands.closeReplay();
    expect(session.getSnapshot().dialog?.kind).toBe('outcome');
    expect(session.getSnapshot().state.outcome).toEqual(outcome);
    session.commands.openReplay(0);
    session.commands.abandon();
    expect(session.getSnapshot().dialog?.kind).toBe('outcome');
    expect(session.getSnapshot().replayCursor).toBeNull();
    expect(session.getSnapshot().homeView).toBeNull();
    session.commands.closeDialog();
    session.commands.openReplay(0);
    session.commands.abandon();
    expect(session.getSnapshot().homeView).toBe('main');
  });

  it('incorpora las pendientes caducadas una sola vez como partidas perdidas', () => {
    const session = createSession();
    session.commands.startMatch(createClassicConfig({ mode: 'machine' }));
    session.commands.abandon();
    expect(
      Object.values(session.getSnapshot().progression.matches).filter((m) => m.completedAt),
    ).toHaveLength(0);
    vi.setSystemTime(Date.now() + 30 * 24 * 60 * 60 * 1000 + 1);
    session.commands.openDialog({ kind: 'profile' });
    const completed = Object.values(session.getSnapshot().progression.matches).filter(
      (m) => m.completedAt,
    );
    expect(completed).toHaveLength(1);
    expect(completed[0].result).toBe(0);
    session.commands.closeDialog();
    session.commands.openDialog({ kind: 'profile' });
    expect(
      Object.values(session.getSnapshot().progression.matches).filter((m) => m.completedAt),
    ).toEqual(completed);
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
    const unlockedCount = Object.keys(session.getSnapshot().progression.unlockedAt).length;
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
    expect(session.getSnapshot().achievementNotification?.achievementId).toBe('p1-13');
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
    expect(session.getSnapshot().achievementNotification).toBeNull();
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

  it.each(['always', 'critical', 'quick'] as const)(
    'advierte antes de perder por orientación con confirmación %s y permite cancelar',
    async (confirmation) => {
      const session = createSession();
      session.commands.loadRecord(savedRecord(8));
      session.commands.updatePreferences({ confirmation });
      const state = structuredClone(session.getSnapshot().state);
      const order = rotation(state);
      session.commands.prepareAction(order);
      expect(session.getSnapshot().state.ply).toBe(8);
      await session.commands.commitPending();
      expect(session.getSnapshot().dialog?.kind).toBe('orientation-loss');
      expect(session.getSnapshot().state).toEqual(state);
      session.commands.closeDialog();
      expect(session.getSnapshot().pendingAction).toBeNull();
      expect(session.getSnapshot().state).toEqual(state);
      session.commands.prepareAction(order);
      await session.commands.commitPending();
      await session.commands.commitPending();
      expect(session.getSnapshot().state.outcome).toEqual({
        type: 'win',
        winner: 1,
        reason: 'orientation',
      });
      expect(
        replayRecord(parseRecord(serializeRecord(session.getSnapshot().matchRecord!))).outcome,
      ).toEqual(session.getSnapshot().state.outcome);
    },
  );

  it('permite inspeccionar ambos bandos mientras la IA piensa sin preparar ni ejecutar órdenes', async () => {
    const search = deferred<GameAction | null>();
    collaborators.chooseAction.mockReturnValueOnce(search.promise);
    const session = createSession();
    const renderer = rendererDouble();
    session.attachRenderer(renderer);
    session.commands.loadRecord(savedRecord(1, 'machine'));
    const before = structuredClone(session.getSnapshot().state);
    expect(session.getSnapshot().machineThinking).toBe(true);
    for (const owner of [0, 1]) {
      const piece = before.pieces.find(
        (candidate) => candidate.owner === owner && candidate.type === 'soldier',
      )!;
      session.commands.selectPiece(piece.id);
      expect(session.getSnapshot().selectedId).toBe(piece.id);
      expect(session.getSnapshot().visibleActions.length).toBeGreaterThan(0);
      expect(renderer.setModel).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selectedId: piece.id,
          inspectingPlayer: 0,
          state: expect.objectContaining({ activePlayer: 1 }),
        }),
      );
      const action = session.getSnapshot().visibleActions[0];
      session.commands.prepareAction(action);
      const move = session
        .getSnapshot()
        .visibleActions.find((candidate) => candidate.kind === 'move');
      if (move?.kind === 'move') session.commands.selectHex(move.to);
      await session.commands.commitPending();
      expect(session.getSnapshot().pendingAction).toBeNull();
      expect(session.getSnapshot().state).toEqual(before);
      session.commands.clearSelection();
      session.commands.selectHex(piece.position);
      expect(session.getSnapshot().selectedId).toBe(piece.id);
    }
    session.commands.clearSelection();
    session.commands.selectNextPiece(false);
    expect(
      before.pieces.find((piece) => piece.id === session.getSnapshot().selectedId)?.owner,
    ).toBe(0);
    const reply = rotation(before);
    search.resolve(reply);
    await vi.advanceTimersByTimeAsync(500);
    expect(session.getSnapshot().state.ply).toBe(before.ply + 1);
    expect(session.getSnapshot().selectedId).toBeNull();
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
      const currentToasts = structuredClone(session.getSnapshot().toasts);
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
      budget.onFallback?.('Aviso tardío de una partida anterior');
      search.resolve(rotation(searchState));
      await vi.advanceTimersByTimeAsync(0);

      expect(session.getSnapshot().state).toEqual(current);
      expect(session.getSnapshot().matchRecord).toEqual(currentRecord);
      expect(session.getSnapshot().toasts).toEqual(currentToasts);
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

  it('usa Frente clásico en la portada y al reiniciar la demostración', async () => {
    const session = createSession();
    const classic = createInitialPieces(2, 3);
    expect(session.getSnapshot().state.pieces).toEqual(classic);
    session.start();
    // No action available forces the demonstration to restart its initial formation.
    collaborators.chooseDemoAction.mockReturnValueOnce(null);
    await vi.advanceTimersByTimeAsync(850);
    expect(session.getSnapshot().state.pieces).toEqual(classic);
    session.commands.startMatch(createClassicConfig({ mode: 'local', initialLayout: 5 }));
    session.commands.showHome();
    expect(session.getSnapshot().state.pieces).toEqual(classic);
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
