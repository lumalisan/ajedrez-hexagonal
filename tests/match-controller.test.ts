import { describe, expect, it } from 'vitest';

import { getLegalActionsForPiece } from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import { MatchController } from '../src/match-controller';
import { createMatchRecord, replayRecord } from '../src/match-record';

describe('controlador de partida', () => {
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
