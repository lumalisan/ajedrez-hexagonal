import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { searchMachineActionWithMetadata } from '../src/ai';
import { createNeuralEvaluator } from '../src/ai-neural';
import { evaluateRangedState, rangedActionPriority } from '../src/ai-ranged';
import {
  applyAction,
  createGameState,
  getAllLegalActions,
  getPreviewActionsForPiece,
} from '../src/engine';
import { directionAtOffset, hexDistance } from '../src/hex';
import type { GameState, Piece } from '../src/types';

const source = readFileSync(new URL('../src/ai-models/hex-value.bin', import.meta.url));
const evaluate = createNeuralEvaluator(
  source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
);
const rules = { repetition: 3, noProgressPlyLimit: 120, orientationOnlyTurnLimit: null };
const forts: Piece[] = [
  { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 3 },
  { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 3 },
];

function choose(state: GameState, rangedPlay = true) {
  const result = searchMachineActionWithMetadata(state, {
    evaluate,
    searchProfile: 'pvs-threats',
    rangedPlay,
    depth: 2,
    budgetMs: 2000,
    seed: 7,
    resolutionRules: rules,
  });
  expect(result.metadata.completedDepth).toBe(2);
  expect(getAllLegalActions(state)).toContainEqual(result.action);
  return result.action!;
}

describe('Neuronal ranged deployment and counterplay', () => {
  it('penalizes exposing multiple units to the same enemy Caza', () => {
    const pieces: Piece[] = [
      ...forts,
      { id: 'plane', type: 'airplane', owner: 1, position: { q: 0, r: 3 }, facing: 0 },
      { id: 'first', type: 'capturer', owner: 0, position: { q: 0, r: 0 } },
      { id: 'second', type: 'capturer', owner: 0, position: { q: 1, r: 0 } },
    ];
    const exposed = createGameState(pieces);
    const spread = createGameState(
      pieces.map((piece) =>
        piece.id === 'second' ? { ...piece, position: { q: 4, r: -4 } } : piece,
      ),
    );
    for (const targetId of ['first', 'second'])
      expect(getPreviewActionsForPiece(exposed, 'plane')).toContainEqual({
        kind: 'shoot',
        pieceId: 'plane',
        targetId,
      });
    expect(evaluateRangedState(exposed, 0)).toBeLessThan(evaluateRangedState(spread, 0));
  });
  it('suppresses the reusable Caza instead of the ground target on the same hex', () => {
    const state = createGameState([
      ...forts,
      { id: 'launcher', type: 'long', owner: 0, position: { q: 0, r: 0 } },
      { id: 'plane', type: 'airplane', owner: 1, position: { q: 0, r: 3 }, facing: 0 },
      { id: 'fast', type: 'fast', owner: 1, position: { q: 0, r: 3 } },
    ]);
    // The old candidate preferred the Embestidor. Both layers are legal targets;
    // removing the reusable shooter matters even when a trade cannot be avoided.
    expect(choose(state, false)).toMatchObject({ targetId: 'fast' });
    const action = choose(state);
    expect(action).toEqual({ kind: 'shoot', pieceId: 'launcher', targetId: 'plane' });
    const result = applyAction(state, action, rules);
    expect(result.state.pieces.some((piece) => piece.id === 'plane')).toBe(false);
    expect(result.state.pieces.some((piece) => piece.id === 'fast')).toBe(true);
  });

  it('deploys a loaded launcher onto the three-hex firing ring', () => {
    const state = createGameState([
      ...forts,
      { id: 'launcher', type: 'long', owner: 0, position: { q: -3, r: 0 } },
      { id: 'plane', type: 'airplane', owner: 1, position: { q: 1, r: 0 }, facing: 3 },
      { id: 'capturer', type: 'capturer', owner: 0, position: { q: 0, r: -3 } },
    ]);
    expect(getPreviewActionsForPiece(state, 'launcher').some((a) => a.kind === 'shoot')).toBe(
      false,
    );
    const action = choose(state);
    expect(action).toMatchObject({ kind: 'move', pieceId: 'launcher' });
    const after = applyAction(state, action, rules).state;
    expect(getPreviewActionsForPiece(after, 'launcher')).toContainEqual({
      kind: 'shoot',
      pieceId: 'launcher',
      targetId: 'plane',
    });
  });

  it('advances the Caza while staying outside an enemy launcher firing ring', () => {
    const state = createGameState([
      ...forts,
      { id: 'plane', type: 'airplane', owner: 0, position: { q: -3, r: 0 }, facing: 2 },
      { id: 'launcher', type: 'long', owner: 1, position: { q: 2, r: 0 } },
      { id: 'capturer', type: 'capturer', owner: 0, position: { q: 0, r: -3 } },
    ]);
    const action = choose(state);
    expect(action).toMatchObject({ kind: 'move', pieceId: 'plane' });
    const after = applyAction(state, action, rules).state;
    const plane = after.pieces.find((piece) => piece.id === 'plane')!;
    expect(hexDistance(plane.position, { q: 2, r: 0 })).toBeLessThan(5);
    expect(getPreviewActionsForPiece(after, 'launcher')).not.toContainEqual({
      kind: 'shoot',
      pieceId: 'launcher',
      targetId: 'plane',
    });
  });

  it('moves a threatened tank out of a Caza firing arc instead of taking infantry bait', () => {
    const state = createGameState([
      ...forts,
      { id: 'tank', type: 'medium', owner: 0, position: { q: 0, r: 0 }, cannon: 5 },
      { id: 'plane', type: 'airplane', owner: 1, position: { q: 0, r: 3 }, facing: 0 },
      { id: 'bait', type: 'soldier', owner: 1, position: { q: -2, r: 0 }, facing: 5 },
    ]);
    expect(getPreviewActionsForPiece(state, 'plane')).toContainEqual({
      kind: 'shoot',
      pieceId: 'plane',
      targetId: 'tank',
    });
    const action = choose(state);
    expect(action).toMatchObject({ kind: 'move', pieceId: 'tank' });
    const after = applyAction(state, action, rules).state;
    expect(getPreviewActionsForPiece(after, 'plane')).not.toContainEqual({
      kind: 'shoot',
      pieceId: 'plane',
      targetId: 'tank',
    });
  });

  it('gives a legal firing deployment priority over closing inside missile range', () => {
    const state = createGameState([
      ...forts,
      { id: 'launcher', type: 'long', owner: 0, position: { q: 0, r: 0 } },
      { id: 'target', type: 'medium', owner: 1, position: { q: 0, r: 2 }, cannon: 3 },
    ]);
    const moves = getAllLegalActions(state);
    const deploy = moves.find((a) => a.kind === 'move' && a.to.q === 0 && a.to.r === -1)!;
    const close = moves.find((a) => a.kind === 'move' && a.to.q === 0 && a.to.r === 1)!;
    expect(deploy).toBeDefined();
    expect(close).toBeDefined();
    expect(rangedActionPriority(state, deploy)).toBeGreaterThan(rangedActionPriority(state, close));
    const after = applyAction(state, deploy, rules).state;
    expect(getPreviewActionsForPiece(after, 'launcher')).toContainEqual({
      kind: 'shoot',
      pieceId: 'launcher',
      targetId: 'target',
    });
  });

  it('does not invent missile fire through a shield or without ammunition', () => {
    const launcher: Piece = { id: 'launcher', type: 'long', owner: 0, position: { q: 0, r: 0 } };
    const target: Piece = {
      id: 'target',
      type: 'airplane',
      owner: 1,
      position: { q: 0, r: 3 },
      facing: 0,
    };
    const clear = createGameState([...forts, launcher, target]);
    const blocked = createGameState([
      ...forts,
      launcher,
      target,
      { id: 'shield', type: 'antiAir', owner: 1, position: { q: 1, r: 2 } },
    ]);
    expect(evaluateRangedState(clear, 0)).toBeGreaterThan(evaluateRangedState(blocked, 0));
    const empty = createGameState([...forts, { ...launcher, missilesRemaining: 0 }, target]);
    expect(getPreviewActionsForPiece(empty, 'launcher').some((a) => a.kind === 'shoot')).toBe(
      false,
    );
    const move = getAllLegalActions(empty).find((a) => a.kind === 'move')!;
    expect(rangedActionPriority(empty, move)).toBe(0);
  });

  it('penalizes a flight intercepted en route even if its final hex is clear', () => {
    const state = createGameState([
      ...forts,
      { id: 'plane', type: 'airplane', owner: 0, position: { q: 0, r: 0 }, facing: 2 },
      { id: 'shield', type: 'antiAir', owner: 1, position: { q: 1, r: -1 } },
    ]);
    const flight = { kind: 'move', pieceId: 'plane', to: { q: 2, r: 0 } } as const;
    expect(getAllLegalActions(state)).toContainEqual(flight);
    expect(applyAction(state, flight, rules).state.pieces.some((p) => p.id === 'plane')).toBe(
      false,
    );
    expect(rangedActionPriority(state, flight)).toBeLessThan(0);
  });

  it('remains zero-sum, rotation symmetric and independent of input mutation', () => {
    const state = createGameState([
      ...forts,
      { id: 'plane', type: 'airplane', owner: 0, position: { q: -2, r: 0 }, facing: 2 },
      { id: 'launcher', type: 'long', owner: 1, position: { q: 1, r: 0 } },
    ]);
    const snapshot = structuredClone(state);
    const rotated = createGameState(
      state.pieces.map((piece): Piece => ({
        ...piece,
        owner: piece.owner === 0 ? 1 : 0,
        position: { q: -piece.position.q, r: -piece.position.r },
        ...('facing' in piece ? { facing: directionAtOffset(piece.facing, 3) } : {}),
      })),
      1,
    );
    expect(evaluateRangedState(state, 0) + evaluateRangedState(state, 1)).toBeCloseTo(0, 10);
    expect(evaluateRangedState(rotated, 1)).toBeCloseTo(evaluateRangedState(state, 0), 10);
    expect(state).toEqual(snapshot);
  });

  it('still takes an immediate Fortress win over suppressing an enemy Caza', () => {
    const state = createGameState([
      ...forts.map((piece): Piece =>
        piece.id === 'f1'
          ? { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 3 }, hp: 1 }
          : piece,
      ),
      { id: 'launcher', type: 'long', owner: 0, position: { q: 0, r: 0 } },
      { id: 'plane', type: 'airplane', owner: 1, position: { q: 3, r: -3 }, facing: 3 },
    ]);
    expect(applyAction(state, choose(state), rules).state.outcome).toMatchObject({
      type: 'win',
      winner: 0,
      reason: 'fortress',
    });
  });
});
