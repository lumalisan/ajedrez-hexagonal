import { describe, expect, it } from 'vitest';

import {
  chooseMachineAction,
  searchMachineAction,
  searchMachineActionWithMetadata,
} from '../src/ai';
import { actionKey } from '../src/action-identity';
import { applyAction, createGameState, getAllLegalActions } from '../src/engine';
import { stepHex } from '../src/hex';
import type { AiPersonality, GameAction, Piece } from '../src/types';

function createChoiceState() {
  return createGameState(
    [
      { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
      { id: 'machine-long', type: 'long', owner: 1, position: { q: 0, r: 2 } },
    ],
    1,
  );
}

function keyOf(action: GameAction | null): string {
  return action ? actionKey(action) : 'null';
}

describe('machine player', () => {
  it('always returns a legal action without mutating the position', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 's1', type: 'soldier', owner: 1, position: { q: 0, r: 2 }, facing: 3 },
      ],
      1,
    );
    const snapshot = JSON.stringify(state);
    const action = chooseMachineAction(state);

    expect(action).not.toBeNull();
    expect(getAllLegalActions(state)).toContainEqual(action);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('prefers an immediate capture over a passive rotation', () => {
    const origin = { q: 0, r: 0 };
    const target = stepHex(origin, 0);
    const pieces: Piece[] = [
      { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
      { id: 'machine-soldier', type: 'soldier', owner: 1, position: origin, facing: 0 },
      { id: 'human-soldier', type: 'soldier', owner: 0, position: target, facing: 3 },
    ];
    const state = createGameState(pieces, 1);
    const action = chooseMachineAction(state);
    const result = action ? applyAction(state, action) : null;

    expect(action?.kind).toBe('move');
    expect(result?.ok).toBe(true);
    expect(result?.state.pieces.some((piece) => piece.id === 'human-soldier')).toBe(false);
  });

  it('advanced search sees a recapture that the recruit overlooks', () => {
    const pieces: Piece[] = [
      { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
      { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
      { id: 'machine-fast', type: 'fast', owner: 1, position: { q: 0, r: 0 } },
      {
        id: 'human-bait',
        type: 'soldier',
        owner: 0,
        position: { q: 0, r: -2 },
        facing: 3,
      },
      { id: 'human-capturer', type: 'capturer', owner: 0, position: { q: 1, r: -2 } },
    ];
    const state = createGameState(pieces, 1);
    const recruit = chooseMachineAction(state);
    const advanced = searchMachineAction(state, { depth: 3, budgetMs: 1_000 });

    expect(recruit).toMatchObject({ kind: 'move', pieceId: 'machine-fast', to: { q: 0, r: -2 } });
    expect(advanced).not.toMatchObject({
      kind: 'move',
      pieceId: 'machine-fast',
      to: { q: 0, r: -2 },
    });
    expect(getAllLegalActions(state)).toContainEqual(advanced);
  });

  it('prefers shooting over a kamikaze when both can destroy the same target', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'machine-airplane', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 },
        { id: 'human-fast', type: 'fast', owner: 0, position: { q: 0, r: 2 } },
      ],
      1,
    );

    expect(chooseMachineAction(state)).toMatchObject({
      kind: 'shoot',
      pieceId: 'machine-airplane',
      targetId: 'human-fast',
    });
  });

  it('uses kamikaze for a favorable exchange but rejects it against a Soldier', () => {
    const favorable = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'machine-airplane', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 },
        { id: 'human-fast', type: 'fast', owner: 0, position: { q: 0, r: 1 } },
      ],
      1,
    );
    expect(chooseMachineAction(favorable)).toMatchObject({
      kind: 'move',
      pieceId: 'machine-airplane',
      to: { q: 0, r: 1 },
      kamikaze: true,
    });

    const unfavorable = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'machine-airplane', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 },
        { id: 'human-soldier', type: 'soldier', owner: 0, position: { q: 0, r: 1 }, facing: 0 },
      ],
      1,
    );
    expect(chooseMachineAction(unfavorable)).not.toMatchObject({
      kind: 'move',
      pieceId: 'machine-airplane',
      to: { q: 0, r: 1 },
      kamikaze: true,
    });
  });

  it('avoids a fake kamikaze stopped by an enemy shield', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'machine-airplane', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 },
        { id: 'human-shield', type: 'antiAir', owner: 0, position: { q: 1, r: 0 } },
        { id: 'human-fast', type: 'fast', owner: 0, position: { q: 0, r: 1 } },
      ],
      1,
    );

    expect(chooseMachineAction(state)).not.toMatchObject({
      kind: 'move',
      pieceId: 'machine-airplane',
      to: { q: 0, r: 1 },
      kamikaze: true,
    });
  });

  it('sacrifices the Avión para causar 1 HP a la Fortaleza', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: 1 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'machine-airplane', type: 'airplane', owner: 1, position: { q: 0, r: 0 }, facing: 3 },
      ],
      1,
    );

    const action = chooseMachineAction(state);
    expect(action).toMatchObject({
      kind: 'move',
      pieceId: 'machine-airplane',
      to: { q: 0, r: 1 },
      kamikaze: true,
    });
    const result = action ? applyAction(state, action) : null;
    expect(result?.state.pieces.find((piece) => piece.id === 'f0')).toMatchObject({ hp: 1 });
    expect(result?.state.pieces.some((piece) => piece.id === 'machine-airplane')).toBe(false);
    expect(result?.state.outcome).toEqual({ type: 'draw', reason: 'blockade' });
  });

  it('repeats the same controlled choice for the same seed', () => {
    const state = createChoiceState();
    const options = { personality: 'balanced', difficulty: 'recruit', seed: 37 } as const;
    const expected = chooseMachineAction(state, options);
    const expectedSearch = searchMachineAction(state, {
      ...options,
      difficulty: 'tactical',
      depth: 1,
      budgetMs: 500,
    });

    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect(chooseMachineAction(state, options)).toEqual(expected);
      expect(
        searchMachineAction(state, {
          ...options,
          difficulty: 'tactical',
          depth: 1,
          budgetMs: 500,
        }),
      ).toEqual(expectedSearch);
    }
  });

  it('varies near-equivalent Recruit and Tactical orders while Expert stays exact', () => {
    const state = createChoiceState();
    const seeds = Array.from({ length: 24 }, (_, seed) => seed);
    const recruitChoices = new Set(
      seeds.map((seed) =>
        keyOf(
          chooseMachineAction(state, {
            personality: 'balanced',
            difficulty: 'recruit',
            seed,
          }),
        ),
      ),
    );
    const tacticalChoices = new Set(
      seeds.map((seed) =>
        keyOf(
          searchMachineAction(state, {
            depth: 1,
            budgetMs: 500,
            personality: 'balanced',
            difficulty: 'tactical',
            seed,
          }),
        ),
      ),
    );
    const expertChoices = new Set(
      seeds.map((seed) =>
        keyOf(
          chooseMachineAction(state, {
            personality: 'balanced',
            difficulty: 'expert',
            seed,
          }),
        ),
      ),
    );
    const commanderChoices = new Set(
      seeds.map((seed) =>
        keyOf(
          chooseMachineAction(state, {
            personality: 'balanced',
            difficulty: 'commander',
            seed,
          }),
        ),
      ),
    );

    expect(recruitChoices.size).toBeGreaterThan(1);
    expect(tacticalChoices.size).toBeGreaterThan(1);
    expect(commanderChoices.size).toBeLessThanOrEqual(2);
    expect(expertChoices.size).toBe(1);
  });

  it('keeps every personality choice legal', () => {
    const state = createChoiceState();
    const personalities: AiPersonality[] = ['balanced', 'aggressive', 'guardian', 'ambush'];
    const legal = getAllLegalActions(state);

    for (const personality of personalities) {
      const action = searchMachineAction(state, {
        depth: 1,
        budgetMs: 500,
        difficulty: 'tactical',
        personality,
        seed: 12,
      });
      expect(legal, personality).toContainEqual(action);
    }
  });

  it('makes the aggressive profile advance while the guardian covers home', () => {
    const state = createChoiceState();
    const aggressive = chooseMachineAction(state, {
      personality: 'aggressive',
      difficulty: 'expert',
      seed: 1,
    });
    const guardian = chooseMachineAction(state, {
      personality: 'guardian',
      difficulty: 'expert',
      seed: 1,
    });

    expect(aggressive).toMatchObject({ kind: 'move', to: { q: 0, r: 1 } });
    expect(guardian).toMatchObject({ kind: 'move', to: { q: 0, r: 3 } });
  });

  it('reports completed depth, nodes and elapsed search time', () => {
    const state = createChoiceState();
    const progress: number[] = [];
    const result = searchMachineActionWithMetadata(state, {
      depth: 2,
      budgetMs: 1_000,
      difficulty: 'expert',
      personality: 'balanced',
      seed: 4,
      onProgress: ({ completedDepth }) => progress.push(completedDepth),
    });

    expect(getAllLegalActions(state)).toContainEqual(result.action);
    expect(result.metadata).toMatchObject({
      requestedDepth: 2,
      completedDepth: 2,
      timedOut: false,
    });
    expect(result.metadata.nodes).toBeGreaterThan(0);
    expect(result.metadata.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.metadata.candidatesConsidered).toBeGreaterThan(0);
    expect(progress).toEqual([1, 2]);
  });
});
