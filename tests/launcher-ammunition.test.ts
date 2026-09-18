import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGameState,
  getFiringRangeCells,
  getLegalActionsForPiece,
  getPiece,
  validateState,
} from '../src/engine';
import { createClassicConfig } from '../src/game-config';
import {
  appendAction,
  createMatchRecord,
  parseRecord,
  replayRecord,
  serializeRecord,
} from '../src/match-record';
import { pieceAccessibleLabel } from '../src/renderer';
import type { GameAction, GameState, Piece } from '../src/types';

function initial(ammunition?: 0 | 1 | 2): GameState {
  return createGameState([
    { id: 'blue-fort', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
    { id: 'amber-fort', type: 'fortress', owner: 1, position: { q: 5, r: 0 }, hp: 2 },
    {
      id: 'launcher',
      type: 'long',
      owner: 0,
      position: { q: 0, r: 0 },
      missilesRemaining: ammunition,
    },
    { id: 'one', type: 'soldier', owner: 1, position: { q: 0, r: -3 }, facing: 0 },
    { id: 'two', type: 'soldier', owner: 1, position: { q: 3, r: -3 }, facing: 0 },
    { id: 'three', type: 'soldier', owner: 1, position: { q: 3, r: 0 }, facing: 0 },
  ]);
}

const shoot = (targetId: string): GameAction => ({ kind: 'shoot', pieceId: 'launcher', targetId });
const reply: GameAction = { kind: 'rotate', pieceId: 'three', facing: 1 };

function perform(state: GameState, action: GameAction): GameState {
  const result = applyAction(state, action);
  expect(result.ok, result.error).toBe(true);
  return result.state;
}

describe('dos misiles por lanzamisiles', () => {
  it('consume los dos disparos sin mutar el origen y rechaza el tercero', () => {
    const before = initial();
    let state = perform(before, shoot('one'));
    expect(getPiece(before, 'launcher')).toHaveProperty('missilesRemaining', undefined);
    expect(getPiece(state, 'launcher')).toHaveProperty('missilesRemaining', 1);
    state = perform(state, reply);
    state = perform(state, shoot('two'));
    state = perform(state, { ...reply, facing: 2 });
    expect(getPiece(state, 'launcher')).toHaveProperty('missilesRemaining', 0);
    expect(getFiringRangeCells(state, 'launcher')).toEqual([]);
    expect(getFiringRangeCells(state, 'launcher', { position: { q: 1, r: 0 } })).toEqual([]);
    expect(
      getLegalActionsForPiece(state, 'launcher').some((action) => action.kind === 'shoot'),
    ).toBe(false);
    const rejected = applyAction(state, shoot('three'));
    expect(rejected.ok).toBe(false);
    expect(rejected.state).toEqual(state);
    const move = getLegalActionsForPiece(state, 'launcher').find(
      (action) => action.kind === 'move',
    )!;
    const moved = perform(state, move);
    expect(getPiece(moved, 'launcher')).toHaveProperty('missilesRemaining', 0);
    moved.activePlayer = 0;
    const transform = getLegalActionsForPiece(moved, 'launcher').find(
      (action) => action.kind === 'transform',
    )!;
    expect(getPiece(perform(moved, transform), 'launcher')?.type).toBe('soldier');
  });

  it.each([0, 1] as const)('conserva %i misiles al cambiar de bando', (ammunition) => {
    const state = initial(ammunition);
    state.activePlayer = 1;
    state.pieces.push({ id: 'capturer', type: 'capturer', owner: 1, position: { q: 0, r: 1 } });
    const after = perform(state, { kind: 'convert', pieceId: 'capturer', targetId: 'launcher' });
    expect(getPiece(after, 'launcher')).toMatchObject({ owner: 1, missilesRemaining: ammunition });
    expect(getPiece(state, 'launcher')?.owner).toBe(0);
  });

  it('consume munición al dañar una Fortaleza y no la consume en una orden ilegal', () => {
    const state = initial();
    const target = getPiece(state, 'one')!;
    state.pieces = state.pieces.filter((piece) => piece.id !== 'one');
    getPiece(state, 'amber-fort')!.position = target.position;
    const after = perform(state, shoot('amber-fort'));
    expect(getPiece(after, 'amber-fort')).toHaveProperty('hp', 1);
    expect(getPiece(after, 'launcher')).toHaveProperty('missilesRemaining', 1);
    expect(applyAction(state, shoot('blue-fort')).ok).toBe(false);
    expect(getPiece(state, 'launcher')).toHaveProperty('missilesRemaining', undefined);
  });

  it('mantiene la munición al exportar, importar y recorrer el replay', () => {
    const state = initial();
    const config = createClassicConfig({ mode: 'local' });
    config.setup = state.pieces.map((piece) => ({ id: piece.id, piece }));
    let record = createMatchRecord(config, state);
    for (const action of [
      shoot('one'),
      reply,
      shoot('two'),
      { ...reply, facing: 2 } as GameAction,
    ]) {
      record = appendAction(record, action);
    }
    const loaded = parseRecord(serializeRecord(record));
    const restored = replayRecord(loaded);
    expect(getPiece(restored, 'launcher')).toHaveProperty('missilesRemaining', 0);
    expect(applyAction(restored, shoot('three')).ok).toBe(false);
    expect(getPiece(replayRecord(loaded, 1), 'launcher')).toHaveProperty('missilesRemaining', 1);
  });

  it('distingue munición en la repetición de posiciones y trata la ausencia como dos misiles', () => {
    expect(initial().positionCounts).toEqual(initial(2).positionCounts);
    expect(initial(0).positionCounts).not.toEqual(initial(1).positionCounts);
    expect(initial(1).positionCounts).not.toEqual(initial(2).positionCounts);
  });

  it('rechaza munición inválida y comunica el agotamiento a lectores de pantalla', () => {
    for (const ammunition of [-1, 3, 0.5, '2', null]) {
      const state = initial();
      Object.assign(getPiece(state, 'launcher')!, { missilesRemaining: ammunition });
      expect(validateState(state)).toContain('El Lanzamisiles launcher tiene munición inválida.');
    }
    const state = initial(0);
    expect(pieceAccessibleLabel(state, getPiece(state, 'launcher') as Piece)).toContain(
      '0 de 2 misiles disponibles',
    );
  });
});
