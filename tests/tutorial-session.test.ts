import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sameAction } from '../src/action-identity';
import type { GameRenderer, GameSession } from '../src/app/contracts';
import { createGameSession } from '../src/app/game-session';
import { getAllLegalActions, getPiece } from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import { appendAction, createMatchRecord, replayRecord } from '../src/match-record';
import { loadActiveMatch, saveActiveMatch } from '../src/match-storage';
import { TUTORIAL_STEPS, getTutorialActions } from '../src/tutorial';
import type { Direction, GameAction, Hex } from '../src/types';
import { installMemoryStorage } from './helpers/memory-storage';

const collaborators = vi.hoisted(() => ({ chooseAction: vi.fn(), disposeAi: vi.fn() }));

vi.mock('../src/audio', () => ({
  AudioDirector: class {
    startMusic = vi.fn();
    setEnabled = vi.fn();
    setVolumes = vi.fn();
    playSelect = vi.fn();
    playInvalid = vi.fn();
    playEvents = vi.fn();
    playTurn = vi.fn();
    playAchievement = vi.fn();
    toggle = vi.fn(() => false);
  },
}));

vi.mock('../src/ai-strategy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ai-strategy')>()),
  WorkerAiStrategy: class {
    chooseAction = collaborators.chooseAction;
    dispose = collaborators.disposeAi;
  },
}));

function rendererDouble() {
  return {
    setDepthMode: vi.fn(),
    snapToPlayer: vi.fn(),
    setModel: vi.fn(),
    resetView: vi.fn(),
    zoomBy: vi.fn(),
    playEvents: vi.fn<GameRenderer['playEvents']>().mockResolvedValue(undefined),
    rotateToPlayer: vi.fn<GameRenderer['rotateToPlayer']>().mockResolvedValue(undefined),
  } satisfies GameRenderer;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function currentStep(session: GameSession) {
  const tutorial = session.getSnapshot().tutorial;
  if (!tutorial) throw new Error('El tutorial debe estar activo.');
  return TUTORIAL_STEPS[tutorial.stepIndex];
}

function enterSection(session: GameSession, section: number): void {
  for (let guard = 0; currentStep(session).section !== section && guard < 20; guard++) {
    session.commands.navigateTutorial(currentStep(session).section < section ? 1 : -1);
  }
  expect(currentStep(session).section).toBe(section);
}

function allowedAction(session: GameSession): GameAction {
  const snapshot = session.getSnapshot();
  const action = getTutorialActions(snapshot.state, snapshot.tutorial!.stepIndex)[0];
  if (!action) throw new Error(`El paso ${currentStep(session).id} debe permitir una orden.`);
  return action;
}

async function commit(session: GameSession): Promise<void> {
  const pending = session.commands.commitPending();
  await vi.advanceTimersByTimeAsync(1_100);
  await pending;
}

async function completeStep(session: GameSession): Promise<void> {
  const step = currentStep(session);
  if (step.interaction === 'next') session.commands.navigateTutorial(1);
  else if (step.interaction === 'inspect') session.commands.selectHex(step.target!);
  else if (step.interaction === 'select') session.commands.selectPiece(step.pieceId!);
  else {
    const action = allowedAction(session);
    session.commands.selectPiece(action.pieceId);
    session.commands.prepareAction(action);
    if (step.interaction !== 'prepare') await commit(session);
  }
}

describe('sesión del tutorial guiado', () => {
  const sessions: GameSession[] = [];

  function createSession() {
    const session = createGameSession();
    sessions.push(session);
    session.commands.startTutorial();
    return session;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    collaborators.chooseAction.mockResolvedValue(null);
    installMemoryStorage();
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { visibilityState: 'visible' });
    vi.stubGlobal('navigator', { vibrate: vi.fn() });
  });

  afterEach(() => {
    for (const session of sessions.splice(0)) session.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('conserva la partida guardada al iniciar, navegar y salir del tutorial', () => {
    let record = createMatchRecord(createClassicConfig({ mode: 'local' }));
    const rotation = getAllLegalActions(replayRecord(record)).find(
      (action) => action.kind === 'rotate',
    )!;
    record = appendAction(record, rotation);
    saveActiveMatch(record);
    const session = createSession();
    expect(session.getSnapshot().matchRecord).toBeNull();
    expect(session.getSnapshot().tutorial).toEqual({ stepIndex: 0, completed: false });
    enterSection(session, 9);
    session.commands.exitTutorial();
    expect(loadActiveMatch().record).toEqual(record);
    session.commands.continueMatch();
    expect(session.getSnapshot().tutorial).toBeNull();
    expect(session.getSnapshot().state).toEqual(replayRecord(record));
  });

  it('rechaza selección ajena y órdenes directas fuera del objetivo guiado', async () => {
    const session = createSession();
    enterSection(session, 3);
    const action = allowedAction(session);
    const before = session.getSnapshot().state;
    const selectedId = session.getSnapshot().selectedId;
    const unrelated = before.pieces.find(
      (piece) => piece.owner === 0 && piece.id !== action.pieceId,
    )!;
    session.commands.selectPiece(unrelated.id);
    expect(session.getSnapshot().selectedId).toBe(selectedId);
    session.commands.selectHex(unrelated.position);
    expect(session.getSnapshot().selectedId).toBe(selectedId);
    session.commands.selectPiece(action.pieceId);
    const forbidden = getAllLegalActions(before).find(
      (candidate) => candidate.pieceId === action.pieceId && !sameAction(candidate, action),
    )!;
    expect(forbidden).toBeDefined();
    session.commands.prepareAction(forbidden);
    await session.commands.commitPending();
    expect(session.getSnapshot().state).toEqual(before);
    expect(session.getSnapshot().pendingAction).toBeNull();
    expect(currentStep(session).id).toBe('3.1');
  });

  it('prepara 3.1 sin mover y muestra la respuesta rival después de confirmar 3.2', async () => {
    const session = createSession();
    const renderer = rendererDouble();
    session.attachRenderer(renderer);
    enterSection(session, 3);
    const before = session.getSnapshot().state;
    const action = allowedAction(session);
    const target = currentStep(session).target!;
    session.commands.selectPiece(action.pieceId);
    session.commands.selectHex(target);
    expect(currentStep(session).id).toBe('3.2');
    expect(session.getSnapshot().pendingAction).toEqual(action);
    expect(session.getSnapshot().state).toEqual(before);
    const committed = session.commands.commitPending();
    await vi.advanceTimersByTimeAsync(0);
    expect(renderer.playEvents).toHaveBeenCalledOnce();
    expect(session.getSnapshot().animating).toBe(true);
    expect(session.getSnapshot().state.activePlayer).toBe(1);
    expect(session.getSnapshot().selectedId).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    await committed;
    expect(renderer.playEvents).toHaveBeenCalledTimes(2);
    const [events, beforeReply] = renderer.playEvents.mock.calls[1];
    expect(
      events.some((event) => event.pieceId && getPiece(beforeReply, event.pieceId)?.owner === 1),
    ).toBe(true);
    expect(session.getSnapshot().state.activePlayer).toBe(0);
    expect(session.getSnapshot().animating).toBe(false);
    expect(currentStep(session).id).not.toBe('3.2');
    expect(collaborators.chooseAction).not.toHaveBeenCalled();
  });

  it('impide confirmar 5.2 hasta orientar el cañón hacia el NE indicado', async () => {
    const session = createSession();
    enterSection(session, 5);
    const action = allowedAction(session);
    if (action.kind !== 'move' || action.cannon === undefined)
      throw new Error('El paso debe mover un Tanque.');
    const before = session.getSnapshot().state;
    const wrong = { ...action, cannon: ((action.cannon + 1) % 6) as Direction };
    session.commands.selectPiece(action.pieceId);
    session.commands.prepareAction(wrong);
    expect(currentStep(session).id).toBe('5.2');
    expect(session.getSnapshot().pendingAction).toEqual(wrong);
    await session.commands.commitPending();
    expect(session.getSnapshot().state).toEqual(before);
    session.commands.prepareAction(action);
    await commit(session);
    expect(getPiece(session.getSnapshot().state, action.pieceId)).toMatchObject({
      type: 'medium',
      position: action.to,
      cannon: action.cannon,
    });
    expect(currentStep(session).id).not.toBe('5.2');
  });

  it('exige orientación y destino correctos al abandonar un vehículo', async () => {
    const session = createSession();
    enterSection(session, 7);
    await completeStep(session);
    expect(currentStep(session).id).toBe('7.2');
    const action = allowedAction(session);
    if (action.kind !== 'transform' || !action.to)
      throw new Error('Debe abandonar el Embestidor desplazándose.');
    const before = session.getSnapshot().state;
    session.commands.selectPiece(action.pieceId);
    session.commands.setMode({ kind: 'transform', facing: null });
    expect(session.getSnapshot().mode).toEqual({ kind: 'transform', facing: null });
    const wrongFacing = ((action.facing + 1) % 6) as Direction;
    session.commands.setMode({ kind: 'transform', facing: wrongFacing });
    expect(session.getSnapshot().mode).toEqual({ kind: 'transform', facing: null });
    session.commands.prepareAction({ ...action, facing: wrongFacing });
    await session.commands.commitPending();
    expect(session.getSnapshot().pendingAction).toBeNull();
    session.commands.setMode({ kind: 'transform', facing: action.facing });
    expect(session.getSnapshot().pendingAction).toBeNull();
    session.commands.prepareAction({
      kind: 'transform',
      pieceId: action.pieceId,
      facing: action.facing,
    });
    await session.commands.commitPending();
    expect(session.getSnapshot().state).toEqual(before);
    expect(currentStep(session).id).toBe('7.2');
    session.commands.prepareAction(action);
    await commit(session);
    expect(getPiece(session.getSnapshot().state, action.pieceId)).toMatchObject({
      type: 'soldier',
      facing: action.facing,
      position: action.to,
    });
  });

  it('reconstruye los apartados al navegar y conserva el paso intermedio de casillas compartidas', () => {
    const session = createSession();
    enterSection(session, 5);
    const checkpoint = structuredClone(session.getSnapshot().state);
    session.commands.prepareAction(allowedAction(session));
    expect(currentStep(session).id).toBe('5.2');
    session.commands.navigateTutorial(1);
    expect(currentStep(session).id).toBe('6.1');
    session.commands.navigateTutorial(-1);
    expect(currentStep(session).id).toBe('5.1');
    expect(session.getSnapshot().pendingAction).toBeNull();
    expect(session.getSnapshot().state).toEqual(checkpoint);
    enterSection(session, 10);
    session.commands.selectHex(currentStep(session).target!);
    expect(currentStep(session).id).toBe('10.2');
    expect(session.getSnapshot().mode).toMatchObject({ kind: 'pieceChoice' });
    session.commands.navigateTutorial(1);
    expect(currentStep(session).id).toBe('10.3');
    session.commands.startTutorial();
    enterSection(session, 5);
    expect(session.getSnapshot().state).toEqual(checkpoint);
  });

  it('recorre todos los ejercicios y llega a la práctica libre sin búsquedas de IA', async () => {
    const session = createSession();
    const visited: string[] = [];
    for (let guard = 0; guard < TUTORIAL_STEPS.length; guard++) {
      const step = currentStep(session);
      visited.push(step.id);
      if (step.interaction === 'free') break;
      await completeStep(session);
      expect(currentStep(session).id, `El paso ${step.id} debe completarse.`).not.toBe(step.id);
    }
    expect(visited).toEqual(TUTORIAL_STEPS.map((step) => step.id));
    expect(session.getSnapshot().state.activePlayer).toBe(0);
    expect(session.getSnapshot().tutorial?.completed).toBe(false);
    expect(collaborators.chooseAction).not.toHaveBeenCalled();
  });

  it('acepta el destino indicado del Dron aunque el motor lo intercepte antes de llegar', async () => {
    const session = createSession();
    enterSection(session, 12);
    session.commands.selectPiece(currentStep(session).pieceId!);
    expect(currentStep(session).id).toBe('12.2');
    const intendedTarget = currentStep(session).target!;
    const action = allowedAction(session);
    if (action.kind !== 'move') throw new Error('El Dron debe desplazarse hacia el escudo.');
    expect(action.to).not.toEqual(intendedTarget);
    session.commands.selectHex(intendedTarget);
    expect(session.getSnapshot().pendingAction).toEqual(action);
    await commit(session);
    expect(getPiece(session.getSnapshot().state, action.pieceId)).toBeUndefined();
    expect(currentStep(session).id).toBe('12.3');
  });

  it('mantiene inmóvil a Ámbar en práctica libre y finaliza al destruir su fortaleza', async () => {
    const session = createSession();
    enterSection(session, 14);
    const enemyPositions = new Map(
      session
        .getSnapshot()
        .state.pieces.filter((piece) => piece.owner === 1)
        .map((piece) => [piece.id, piece.position]),
    );
    const move = async (pieceId: string, to: Hex) => {
      const snapshot = session.getSnapshot();
      const action = getTutorialActions(snapshot.state, snapshot.tutorial!.stepIndex).find(
        (candidate) =>
          candidate.kind === 'move' &&
          candidate.pieceId === pieceId &&
          candidate.to.q === to.q &&
          candidate.to.r === to.r,
      );
      if (!action) throw new Error(`No hay movimiento de ${pieceId} a ${to.q},${to.r}.`);
      session.commands.selectPiece(pieceId);
      session.commands.prepareAction(action);
      await commit(session);
      if (!session.getSnapshot().tutorial?.completed)
        expect(session.getSnapshot().state.activePlayer).toBe(0);
      for (const piece of session.getSnapshot().state.pieces.filter((piece) => piece.owner === 1)) {
        expect(piece.position).toEqual(enemyPositions.get(piece.id));
      }
    };
    for (const [q, r] of [
      [-4, 3],
      [-1, 3],
      [-1, 5],
      [0, 5],
      [0, 4],
    ]) {
      await move('tutorial-cian-fast', { q, r });
    }
    expect(session.getSnapshot().tutorial?.completed).toBe(false);
    expect(getPiece(session.getSnapshot().state, 'tutorial-amber-fortress')).toMatchObject({
      hp: 1,
    });
    for (const [q, r] of [
      [2, -2],
      [2, -1],
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 3],
      [0, 4],
    ]) {
      await move('tutorial-cian-capturer', { q, r });
    }
    expect(session.getSnapshot().tutorial?.completed).toBe(true);
    expect(session.getSnapshot().state.outcome).toMatchObject({ type: 'win', winner: 0 });
    expect(collaborators.chooseAction).not.toHaveBeenCalled();
    expect(loadActiveMatch().record).toBeNull();
  });

  it('recorre con U y Mayús+U solo los actores permitidos y permite seleccionar al Dron', async () => {
    const session = createSession();
    enterSection(session, 3);
    await completeStep(session);
    await completeStep(session);
    expect(currentStep(session).id).toBe('3.3');
    expect(session.getSnapshot().selectedId).toBeNull();
    session.commands.selectNextPiece(false);
    expect(session.getSnapshot().selectedId).toBe(currentStep(session).pieceId);
    session.commands.selectNextPiece(true);
    expect(session.getSnapshot().selectedId).toBe(currentStep(session).pieceId);

    enterSection(session, 10);
    session.commands.selectHex(currentStep(session).target!);
    session.commands.navigateTutorial(1);
    const permitted = new Set(
      getTutorialActions(
        session.getSnapshot().state,
        session.getSnapshot().tutorial!.stepIndex,
      ).map((action) => action.pieceId),
    );
    const visited: string[] = [];
    for (let index = 0; index < permitted.size; index++) {
      session.commands.selectNextPiece(false);
      visited.push(session.getSnapshot().selectedId!);
    }
    expect(new Set(visited)).toEqual(permitted);
    session.commands.selectNextPiece(true);
    expect(session.getSnapshot().selectedId).toBe(visited.at(-2));

    enterSection(session, 12);
    expect(currentStep(session).id).toBe('12.1');
    session.commands.selectNextPiece(false);
    expect(currentStep(session).id).toBe('12.2');
    expect(session.getSnapshot().selectedId).toBe('tutorial-cian-drone');
  });

  it.each(['actor', 'respuesta'] as const)(
    'restaura un paso jugable al remontar durante la animación de %s',
    async (phase) => {
      const session = createSession();
      session.start();
      const renderer = rendererDouble();
      const animation = deferred();
      if (phase === 'respuesta') renderer.playEvents.mockResolvedValueOnce(undefined);
      renderer.playEvents.mockReturnValueOnce(animation.promise);
      session.attachRenderer(renderer);
      enterSection(session, 3);
      session.commands.prepareAction(allowedAction(session));
      const checkpoint = session.getSnapshot();
      const committed = session.commands.commitPending();
      await vi.advanceTimersByTimeAsync(phase === 'respuesta' ? 1_000 : 0);
      expect(renderer.playEvents).toHaveBeenCalledTimes(phase === 'respuesta' ? 2 : 1);
      expect(session.getSnapshot().animating).toBe(true);
      session.dispose();
      session.start();
      expect(session.getSnapshot()).toMatchObject({
        tutorial: checkpoint.tutorial,
        state: checkpoint.state,
        pendingAction: checkpoint.pendingAction,
        animating: false,
      });
      expect(session.getSnapshot().state.activePlayer).toBe(0);
      animation.resolve();
      await committed;
      expect(session.getSnapshot().state).toEqual(checkpoint.state);
      expect(currentStep(session).id).toBe('3.2');
      await commit(session);
      expect(currentStep(session).id).toBe('3.3');
      expect(session.getSnapshot().state.activePlayer).toBe(0);
      expect(session.getSnapshot().animating).toBe(false);
    },
  );

  it.each(['reiniciar', 'desmontar'] as const)(
    'descarta la animación tardía de la respuesta rival al %s',
    async (operation) => {
      const session = createSession();
      const renderer = rendererDouble();
      const animation = deferred();
      renderer.playEvents.mockResolvedValueOnce(undefined).mockReturnValueOnce(animation.promise);
      session.attachRenderer(renderer);
      enterSection(session, 3);
      session.commands.prepareAction(allowedAction(session));
      const committed = session.commands.commitPending();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(renderer.playEvents).toHaveBeenCalledTimes(2);
      if (operation === 'reiniciar') session.commands.startTutorial();
      else session.dispose();
      const state = session.getSnapshot().state;
      const progress = session.getSnapshot().tutorial;
      const onChange = vi.fn();
      const unsubscribe = session.subscribe(onChange);
      animation.resolve();
      await committed;
      await vi.advanceTimersByTimeAsync(1_500);
      expect(session.getSnapshot().state).toEqual(state);
      expect(session.getSnapshot().tutorial).toEqual(progress);
      expect(onChange).not.toHaveBeenCalled();
      expect(renderer.playEvents).toHaveBeenCalledTimes(2);
      unsubscribe();
    },
  );
});
