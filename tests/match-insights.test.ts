import { describe, expect, it } from 'vitest';

import { applyAction, createGameState, getLegalActionsForPiece, getPiece } from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import { analyzeMatchMoments, replayStateAt } from '../src/match-insights';
import { appendAction, createMatchRecord, resolutionRulesForConfig } from '../src/match-record';
import type { Direction, Piece } from '../src/types';

const pieces: Piece[] = [
  { id: 'bf', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
  { id: 'af', type: 'fortress', owner: 1, position: { q: 5, r: 0 }, hp: 2 },
  { id: 'bs', type: 'soldier', owner: 0, position: { q: 0, r: 0 }, facing: 0 },
  { id: 'as', type: 'soldier', owner: 1, position: { q: 0, r: -1 }, facing: 3 },
];

describe('match insights', () => {
  it('finds material swings and reconstructs their position', () => {
    const initial = createGameState(pieces);
    const config = {
      ...createClassicConfig({ mode: 'local' }),
      setup: pieces.map((piece) => ({ id: piece.id, piece })),
    };
    let record = createMatchRecord(config, initial);
    const capture = getLegalActionsForPiece(initial, 'bs').find(
      (action) => action.kind === 'move' && action.to.q === 0 && action.to.r === -1,
    );
    expect(capture).toBeDefined();
    record = appendAction(record, capture!);
    const moments = analyzeMatchMoments(record);
    expect(moments).toHaveLength(1);
    expect(moments[0].title).toBe('Cambio de iniciativa');
    expect(replayStateAt(record, 1).pieces.some((piece) => piece.id === 'as')).toBe(false);
  });

  it('replays and analyzes beyond the classic limit when the record config allows it', () => {
    const initial = createGameState(pieces);
    const config = {
      ...createClassicConfig({ mode: 'local', noProgressPlyLimit: 160 }),
      setup: pieces.map((piece) => ({ id: piece.id, piece })),
      victory: {
        ...createClassicConfig({ mode: 'local' }).victory,
        repetition: 0,
      },
    };
    const rules = resolutionRulesForConfig(config);
    let record = createMatchRecord(config, initial);
    let state = initial;

    for (let index = 0; index < 120; index += 1) {
      const pieceId = state.activePlayer === 0 ? 'bs' : 'as';
      const piece = getPiece(state, pieceId);
      expect(piece?.type).toBe('soldier');
      const facing = (((piece?.type === 'soldier' ? piece.facing : 0) + 1) % 6) as Direction;
      const action = getLegalActionsForPiece(state, pieceId).find(
        (candidate) => candidate.kind === 'rotate' && candidate.facing === facing,
      );
      expect(action).toBeDefined();
      const result = applyAction(state, action!, rules);
      expect(result.ok).toBe(true);
      record = appendAction(record, action!);
      state = result.state;
    }

    const capture = getLegalActionsForPiece(state, 'bs').find(
      (action) => action.kind === 'move' && action.to.q === 0 && action.to.r === -1,
    );
    expect(capture).toBeDefined();
    const captureResult = applyAction(state, capture!, rules);
    expect(captureResult.ok).toBe(true);
    record = appendAction(record, capture!);

    expect(replayStateAt(record, 121).ply).toBe(121);
    expect(analyzeMatchMoments(record).some((moment) => moment.actionIndex === 121)).toBe(true);
  });
});
