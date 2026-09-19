import { describe, expect, it } from 'vitest';

import { createGameState, getAllLegalActions, getLegalActionsForPiece } from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import { MatchController } from '../src/match-controller';
import { createMatchRecord, parseRecord, replayRecord, serializeRecord } from '../src/match-record';
import type { GameAction, Outcome } from '../src/types';

function rotationForActivePlayer(controller: MatchController): GameAction {
  const rotation = getAllLegalActions(controller.store.getState().game).find(
    (action) => action.kind === 'rotate',
  );
  expect(rotation).toBeDefined();
  return rotation!;
}

describe('controlador de partida', () => {
  it.each(['local', 'machine'] as const)('habilita deshacer en partidas %s', (mode) => {
    expect(createClassicConfig({ mode }).options.allowUndo).toBe(true);
  });

  it('deshace y rehace varias órdenes restaurando todo el estado', () => {
    const controller = new MatchController(
      createMatchRecord(createClassicConfig({ mode: 'local' })),
    );
    const states = [structuredClone(controller.store.getState().game)];
    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(false);
    expect(controller.undo()).toBe(false);
    expect(controller.redo()).toBe(false);

    for (let index = 0; index < 3; index += 1) {
      expect(controller.commit(rotationForActivePlayer(controller)).ok).toBe(true);
      states.push(structuredClone(controller.store.getState().game));
    }
    const actions = structuredClone(controller.record.actions);
    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(false);

    const pendingAction = rotationForActivePlayer(controller);
    expect(controller.prepare(pendingAction)).toBe(true);
    controller.store.update((current) => ({
      ...current,
      ui: {
        ...current.ui,
        selectedPieceId: pendingAction.pieceId,
        interactionMode: { kind: 'rotate' },
      },
    }));
    for (let index = 2; index >= 0; index -= 1) {
      expect(controller.undo()).toBe(true);
      expect(controller.store.getState().game).toEqual(states[index]);
      expect(controller.record.currentAction).toBe(index);
      expect(controller.record.actions).toEqual(actions);
      expect(controller.store.getState().ui).toMatchObject({
        selectedPieceId: null,
        pendingAction: null,
        interactionMode: { kind: 'default' },
        lastEvents: [],
      });
    }
    expect(controller.undo()).toBe(false);
    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(true);

    for (let index = 1; index < states.length; index += 1) {
      expect(controller.redo()).toBe(true);
      expect(controller.store.getState().game).toEqual(states[index]);
      expect(controller.record.currentAction).toBe(index);
    }
    expect(controller.redo()).toBe(false);
  });

  it('restaura una unidad capturada y vuelve a capturarla al rehacer', () => {
    const initialState = createGameState([
      { id: 'fort-blue', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
      { id: 'fort-amber', type: 'fortress', owner: 1, position: { q: 5, r: 0 }, hp: 2 },
      { id: 'blue', type: 'soldier', owner: 0, position: { q: 0, r: 0 }, facing: 0 },
      { id: 'amber', type: 'soldier', owner: 1, position: { q: 0, r: -1 }, facing: 3 },
    ]);
    const controller = new MatchController(
      createMatchRecord(createClassicConfig({ mode: 'local' }), initialState),
    );
    const capture = controller
      .legalActions('blue')
      .find((action) => action.kind === 'move' && action.to.q === 0 && action.to.r === -1);
    expect(capture).toBeDefined();
    expect(controller.commit(capture!).ok).toBe(true);
    const afterCapture = structuredClone(controller.store.getState().game);
    expect(afterCapture.pieces.some((piece) => piece.id === 'amber')).toBe(false);
    expect(controller.undo()).toBe(true);
    expect(controller.store.getState().game).toEqual(initialState);
    expect(controller.redo()).toBe(true);
    expect(controller.store.getState().game).toEqual(afterCapture);
  });

  it('descarta el futuro solo al confirmar una nueva orden legal', () => {
    const controller = new MatchController(
      createMatchRecord(createClassicConfig({ mode: 'local' })),
    );
    const first = rotationForActivePlayer(controller);
    expect(controller.commit(first).ok).toBe(true);
    expect(controller.commit(rotationForActivePlayer(controller)).ok).toBe(true);
    expect(controller.undo()).toBe(true);
    expect(controller.undo()).toBe(true);

    const actions = structuredClone(controller.record.actions);
    expect(controller.commit({ ...first, pieceId: 'missing' }).ok).toBe(false);
    expect(controller.record.actions).toEqual(actions);
    expect(controller.canRedo()).toBe(true);

    const alternative = getAllLegalActions(controller.store.getState().game).find(
      (action) => action.kind === 'move',
    );
    expect(alternative).toBeDefined();
    expect(controller.prepare(alternative!)).toBe(true);
    expect(controller.canRedo()).toBe(true);
    expect(controller.commit(alternative!).ok).toBe(true);
    expect(controller.record.actions).toEqual([alternative]);
    expect(controller.record.currentAction).toBe(1);
    expect(controller.canRedo()).toBe(false);
    expect(controller.redo()).toBe(false);
  });

  it('respeta la opción de desactivar deshacer y rehacer', () => {
    const config = createClassicConfig({ mode: 'local' });
    config.options.allowUndo = false;
    const controller = new MatchController(createMatchRecord(config));
    expect(controller.commit(rotationForActivePlayer(controller)).ok).toBe(true);
    expect(controller.canUndo()).toBe(false);
    expect(controller.undo()).toBe(false);
    expect(controller.record.currentAction).toBe(1);
    controller.jumpTo(0);
    expect(controller.canRedo()).toBe(false);
    expect(controller.redo()).toBe(false);
    expect(controller.record.currentAction).toBe(0);
  });

  it('conserva la posición y el futuro al guardar y recargar tras deshacer y rehacer', () => {
    let controller = new MatchController(createMatchRecord(createClassicConfig({ mode: 'local' })));
    expect(controller.commit(rotationForActivePlayer(controller)).ok).toBe(true);
    const afterFirst = structuredClone(controller.store.getState().game);
    expect(controller.commit(rotationForActivePlayer(controller)).ok).toBe(true);
    const afterSecond = structuredClone(controller.store.getState().game);
    expect(controller.undo()).toBe(true);

    controller = new MatchController(parseRecord(serializeRecord(controller.record)));
    expect(controller.store.getState().game).toEqual(afterFirst);
    expect(controller.canRedo()).toBe(true);
    expect(controller.redo()).toBe(true);
    controller = new MatchController(parseRecord(serializeRecord(controller.record)));
    expect(controller.store.getState().game).toEqual(afterSecond);
    expect(controller.canRedo()).toBe(false);
    expect(controller.undo()).toBe(true);
    expect(controller.store.getState().game).toEqual(afterFirst);
  });

  it('permite corregir un final por movimiento y rehacerlo incluso tras recargar', () => {
    let controller = new MatchController(
      createMatchRecord(createClassicConfig({ mode: 'local', noProgressPlyLimit: 1 })),
    );
    const initial = structuredClone(controller.store.getState().game);
    const result = controller.commit(rotationForActivePlayer(controller));
    expect(result.state.outcome).toEqual({ type: 'draw', reason: 'no-progress' });
    controller.conclude(result.state.outcome!);
    const terminal = structuredClone(controller.store.getState().game);
    expect(controller.canUndo()).toBe(true);
    expect(controller.undo()).toBe(true);
    expect(controller.store.getState().game).toEqual(initial);

    controller = new MatchController(parseRecord(serializeRecord(controller.record)));
    expect(controller.redo()).toBe(true);
    expect(controller.store.getState().game).toEqual(terminal);
    expect(controller.undo()).toBe(true);
    const move = getAllLegalActions(controller.store.getState().game).find(
      (action) => action.kind === 'move',
    );
    expect(move).toBeDefined();
    expect(controller.commit(move!).ok).toBe(true);
    expect(controller.record.conclusion).toBeNull();
    expect(controller.record.actions).toEqual([move]);
  });

  it.each<Outcome>([
    { type: 'win', winner: 1, reason: 'resignation' },
    { type: 'win', winner: 1, reason: 'timeout' },
    { type: 'draw', reason: 'blockade' },
  ])('impide reabrir una conclusión externa de $reason', (outcome) => {
    const controller = new MatchController(
      createMatchRecord(createClassicConfig({ mode: 'local' })),
    );
    expect(controller.commit(rotationForActivePlayer(controller)).ok).toBe(true);
    controller.conclude(outcome);
    expect(controller.canUndo()).toBe(false);
    expect(controller.undo()).toBe(false);
    expect(controller.store.getState().game.outcome).toEqual(outcome);
    controller.jumpTo(0);
    expect(controller.canRedo()).toBe(false);
    expect(controller.redo()).toBe(false);
  });

  it('mantiene el tiempo consumido al deshacer y rehacer', () => {
    const controller = new MatchController(
      createMatchRecord(createClassicConfig({ mode: 'local', clockSeconds: 10 })),
    );
    controller.resumeClock(1_000);
    expect(controller.commit(rotationForActivePlayer(controller)).ok).toBe(true);
    controller.switchClock(1, 3_000);
    controller.tickClock(4_000);
    const clock = structuredClone(controller.record.clock);
    expect(clock?.remainingMs).toEqual([8_000, 9_000]);
    expect(controller.undo()).toBe(true);
    expect(controller.record.clock).toEqual(clock);
    expect(controller.redo()).toBe(true);
    expect(controller.record.clock).toEqual(clock);
  });

  it('usa los límites configurados al confirmar una orden', () => {
    const record = createMatchRecord(
      createClassicConfig({
        mode: 'local',
        noProgressPlyLimit: 1,
      }),
    );
    const controller = new MatchController(record);
    const state = controller.store.getState().game;
    const soldier = state.pieces.find((piece) => piece.owner === 0 && piece.type === 'soldier');
    expect(soldier).toBeDefined();
    const rotation = getLegalActionsForPiece(state, soldier!.id).find(
      (action) => action.kind === 'rotate',
    );
    expect(rotation).toBeDefined();
    const result = controller.commit(rotation!);
    expect(result.ok).toBe(true);
    expect(result.state.outcome).toEqual({ type: 'draw', reason: 'no-progress' });
    expect(replayRecord(controller.record).outcome).toEqual(result.state.outcome);
  });

  it('persiste rendición y timeout en el registro y en el store', () => {
    const resignationController = new MatchController(
      createMatchRecord(createClassicConfig({ mode: 'local' })),
    );
    resignationController.resign(0);
    expect(resignationController.store.getState().game.outcome).toEqual({
      type: 'win',
      winner: 1,
      reason: 'resignation',
    });
    expect(resignationController.record.actions).toEqual([]);

    const clockController = new MatchController(
      createMatchRecord(createClassicConfig({ mode: 'local', clockSeconds: 1 })),
    );
    clockController.resumeClock(100);
    const expired = clockController.tickClock(1_100);
    expect(expired).toMatchObject({ status: 'timeout', timedOutPlayer: 0 });
    expect(clockController.store.getState().game.outcome).toEqual({
      type: 'win',
      winner: 1,
      reason: 'timeout',
    });
    expect(clockController.record.conclusion?.outcome).toEqual({
      type: 'win',
      winner: 1,
      reason: 'timeout',
    });
  });

  it('cambia de jugador cobrando primero el tiempo consumido', () => {
    const controller = new MatchController(
      createMatchRecord(createClassicConfig({ mode: 'local', clockSeconds: 10 })),
    );
    controller.resumeClock(1_000);
    const switched = controller.switchClock(1, 3_500);
    expect(switched?.remainingMs).toEqual([7_500, 10_000]);
    expect(switched?.activePlayer).toBe(1);
    expect(controller.record.clock).toEqual(switched);
  });
});
