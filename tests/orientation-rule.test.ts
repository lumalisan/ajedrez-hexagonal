import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGameState,
  getAllLegalActions,
  cloneState,
  validateState,
} from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import { MatchController } from '../src/match-controller';
import { createMatchRecord, parseRecord, serializeRecord, replayRecord } from '../src/match-record';
import type { GameAction, GameState } from '../src/types';

function position(): GameState {
  return createGameState([
    { id: 'f0', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
    { id: 'f1', type: 'fortress', owner: 1, position: { q: 5, r: 0 }, hp: 2 },
    { id: 's0', type: 'soldier', owner: 0, position: { q: -2, r: 0 }, facing: 0 },
    { id: 't0', type: 'medium', owner: 0, position: { q: -2, r: 1 }, cannon: 0 },
    { id: 's1', type: 'soldier', owner: 1, position: { q: 2, r: 0 }, facing: 3 },
  ]);
}

function action(state: GameState, kind: GameAction['kind']) {
  const order = getAllLegalActions(state).find((candidate) => candidate.kind === kind);
  if (!order) throw new Error(`No hay orden ${kind}`);
  return order;
}

describe('cinco turnos propios de orientación', () => {
  it('no declara tablas por tercera repetición ni por 120 medias jugadas en las reglas actuales', () => {
    const state = position();
    state.noProgressPlyCount = 119;
    const order = action(state, 'move');
    const positions = Object.keys(applyAction(state, order).state.positionCounts);
    state.positionCounts = Object.fromEntries(positions.map((key) => [key, 2]));
    const result = applyAction(state, order);
    expect(result.ok).toBe(true);
    expect(result.state.noProgressPlyCount).toBe(120);
    expect(Object.values(result.state.positionCounts)).toContain(3);
    expect(result.state.outcome).toBeNull();
  });

  it.each([
    ['medium', 'drone'],
    ['long', 'drone'],
    ['fast', 'drone'],
    ['medium', 'airplane'],
    ['long', 'airplane'],
    ['fast', 'airplane'],
  ] as const)(
    'convertir %s y atacar %s conserva el rumbo elegido y reinicia la racha',
    (vehicle, aircraft) => {
      const state = position();
      state.pieces = state.pieces.filter((piece) => piece.id !== 't0');
      state.pieces.push(
        vehicle === 'medium'
          ? { id: 'vehicle', type: 'medium', owner: 0, position: { q: 0, r: 0 }, cannon: 0 }
          : { id: 'vehicle', type: vehicle, owner: 0, position: { q: 0, r: 0 } },
        aircraft === 'airplane'
          ? { id: 'air', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 }
          : { id: 'air', type: 'drone', owner: 1, position: { q: 0, r: 0 } },
      );
      state.orientationOnlyTurns = [4, 2];
      const order = getAllLegalActions(state).find(
        (candidate) =>
          candidate.kind === 'transform' &&
          candidate.pieceId === 'vehicle' &&
          candidate.facing === 4 &&
          candidate.attackAboveId === 'air' &&
          !candidate.to,
      );
      expect(order).toBeDefined();
      const result = applyAction(state, order!);
      expect(result.ok).toBe(true);
      expect(result.state.pieces.find((piece) => piece.id === 'vehicle')).toMatchObject({
        type: 'soldier',
        facing: 4,
      });
      expect(result.state.pieces.some((piece) => piece.id === 'air')).toBe(false);
      expect(result.state.orientationOnlyTurns).toEqual([0, 2]);
      expect(result.state.outcome).toBeNull();
    },
  );

  it('suma giros de distintas unidades y pierde en el quinto, independientemente del rival', () => {
    let state = position();
    for (let turn = 1; turn <= 5; turn++) {
      const before = cloneState(state);
      const result = applyAction(state, action(state, turn % 2 ? 'rotate' : 'orient'));
      expect(state).toEqual(before);
      state = result.state;
      expect(state.orientationOnlyTurns?.[0]).toBe(turn);
      if (turn === 5) {
        expect(state.outcome).toEqual({ type: 'win', winner: 1, reason: 'orientation' });
        expect(result.events).toContainEqual({ type: 'victory', owner: 1 });
      } else {
        expect(state.outcome).toBeNull();
        state = applyAction(state, action(state, 'move')).state;
        expect(state.orientationOnlyTurns).toEqual([turn, 0]);
      }
    }
  });

  it.each(['move', 'transform'] as const)(
    'una acción %s reinicia solo el contador propio',
    (kind) => {
      const state = position();
      state.orientationOnlyTurns = [4, 3];
      const result = applyAction(state, action(state, kind));
      expect(result.ok).toBe(true);
      expect(result.state.orientationOnlyTurns).toEqual([0, 3]);
      expect(result.state.outcome).toBeNull();
      expect(state.orientationOnlyTurns).toEqual([4, 3]);
    },
  );

  it('una orden ilegal no avanza el contador', () => {
    const state = position();
    state.orientationOnlyTurns = [4, 0];
    const result = applyAction(state, { kind: 'rotate', pieceId: 'missing', facing: 1 });
    expect(result.ok).toBe(false);
    expect(result.state.orientationOnlyTurns).toEqual([4, 0]);
  });

  it('guarda la derrota, la importa, la reproduce y permite deshacer y rehacer', () => {
    const controller = new MatchController(
      createMatchRecord(createClassicConfig({ mode: 'local' }), position()),
    );
    for (let ply = 0; ply < 9; ply++) {
      const state = controller.store.getState().game;
      expect(controller.commit(action(state, 'rotate')).ok).toBe(true);
    }
    const expected = { type: 'win', winner: 1, reason: 'orientation' };
    const restored = parseRecord(serializeRecord(controller.record));
    expect(replayRecord(restored).outcome).toEqual(expected);
    expect(replayRecord(restored, 8).orientationOnlyTurns).toEqual([4, 4]);
    expect(controller.undo()).toBe(true);
    expect(controller.store.getState().game.outcome).toBeNull();
    expect(controller.redo()).toBe(true);
    expect(controller.store.getState().game.outcome).toEqual(expected);
  });

  it('los registros antiguos sin la nueva regla no sufren la penalización', () => {
    const config = createClassicConfig({ mode: 'local' });
    delete config.options.orientationOnlyTurnLimit;
    const controller = new MatchController(createMatchRecord(config, position()));
    for (let ply = 0; ply < 14; ply++) {
      const state = controller.store.getState().game;
      expect(controller.commit(action(state, 'rotate')).ok).toBe(true);
    }
    expect(replayRecord(parseRecord(serializeRecord(controller.record))).outcome).toBeNull();
  });

  it('valida los contadores importados y no los comparte al clonar', () => {
    const state = position();
    state.orientationOnlyTurns = [4, 2];
    const copy = cloneState(state);
    copy.orientationOnlyTurns![0] = 0;
    expect(state.orientationOnlyTurns).toEqual([4, 2]);
    state.orientationOnlyTurns[0] = -1;
    expect(validateState(state)).toContain(
      'Los contadores de turnos de orientación no son válidos.',
    );
  });
});
