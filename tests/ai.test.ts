import { describe, expect, it, vi } from 'vitest';

import {
  chooseMachineAction,
  searchMachineAction,
  searchMachineActionWithMetadata,
} from '../src/ai';
import { actionKey } from '../src/action-identity';
import { applyAction, createGameState, getAllLegalActions } from '../src/engine';
import { stepHex } from '../src/hex';
import type { AiDifficulty, AiPersonality, GameAction, Piece } from '../src/types';

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

  it('sees an enemy conversion beyond the completed depth instead of taking poisoned bait', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'machine-fast', type: 'fast', owner: 1, position: { q: 0, r: 0 } },
        { id: 'human-bait', type: 'soldier', owner: 0, position: { q: 0, r: -2 }, facing: 3 },
        { id: 'human-capturer', type: 'capturer', owner: 0, position: { q: 1, r: -2 } },
      ],
      1,
    );
    const result = searchMachineActionWithMetadata(state, { depth: 1, budgetMs: 1_000 });

    expect(result.metadata.completedDepth).toBe(1);
    expect(result.action).not.toMatchObject({
      kind: 'move',
      pieceId: 'machine-fast',
      to: { q: 0, r: -2 },
    });
    expect(getAllLegalActions(state)).toContainEqual(result.action);
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

  it.each<AiDifficulty>(['recruit', 'tactical', 'commander', 'expert'])(
    'varies near-equivalent orders reproducibly in %s',
    (difficulty) => {
      const state = createChoiceState();
      const seeds = Array.from({ length: 24 }, (_, seed) => seed);
      const choices = seeds.map((seed) => {
        const options = {
          depth: 1,
          budgetMs: 500,
          personality: 'balanced' as const,
          difficulty,
          seed,
        };
        const choose = () =>
          difficulty === 'recruit'
            ? chooseMachineAction(state, options)
            : searchMachineAction(state, options);
        const choice = choose();
        expect(getAllLegalActions(state)).toContainEqual(choice);
        expect(choose()).toEqual(choice);
        return keyOf(choice);
      });
      expect(new Set(choices).size).toBeGreaterThan(1);
    },
  );

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

  it('values a loaded launcher above an empty one when choosing a conversion', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'capturer', type: 'capturer', owner: 1, position: { q: 0, r: 0 } },
        { id: 'empty', type: 'long', owner: 0, position: { q: 1, r: -1 }, missilesRemaining: 0 },
        { id: 'loaded', type: 'long', owner: 0, position: { q: -1, r: 1 }, missilesRemaining: 2 },
      ],
      1,
    );

    expect(chooseMachineAction(state, { difficulty: 'expert' })).toMatchObject({
      kind: 'convert',
      targetId: 'loaded',
    });
  });

  it('uses the match draw rules instead of inventing a no-progress draw', () => {
    const state = createChoiceState();
    state.noProgressPlyCount = 119;
    const standard = searchMachineActionWithMetadata(state, { depth: 1, budgetMs: 1_000 });
    const unlimited = searchMachineActionWithMetadata(state, {
      depth: 1,
      budgetMs: 1_000,
      resolutionRules: { repetition: null, noProgressPlyLimit: null },
    });

    expect(standard.metadata.score).toBe(0);
    expect(unlimited.metadata.score).toBeGreaterThan(0);
    expect(getAllLegalActions(state)).toContainEqual(unlimited.action);
  });

  it('does not mistake an inferior alpha-beta bound for an equally good root move', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'a-machine', type: 'soldier', owner: 1, position: { q: 2, r: 0 }, facing: 2 },
        { id: 'b-machine', type: 'capturer', owner: 1, position: { q: 1, r: 0 } },
        { id: 'a-human', type: 'soldier', owner: 0, position: { q: -3, r: 2 }, facing: 1 },
        { id: 'b-human', type: 'capturer', owner: 0, position: { q: 3, r: 0 } },
      ],
      1,
    );

    // Retreating to (2,1) previously inherited the winning capture's bound and
    // won the alphabetical tie-break, despite losing material to a conversion.
    for (const difficulty of ['tactical', 'expert'] as const) {
      expect(searchMachineAction(state, { depth: 2, budgetMs: 1_000, difficulty })).toMatchObject({
        kind: 'move',
        pieceId: 'a-machine',
        to: { q: 3, r: 0 },
      });
    }
  });

  it('blocks a fatal Fortress attack quietly and sees the conversion after the block', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 1 },
        { id: 'tank', type: 'medium', owner: 1, position: { q: 1, r: 3 }, cannon: 2 },
        { id: 'capturer', type: 'capturer', owner: 1, position: { q: 1, r: 4 } },
        { id: 'human-fast', type: 'fast', owner: 0, position: { q: 0, r: 2 } },
        { id: 'human-soldier', type: 'soldier', owner: 0, position: { q: -4, r: 0 }, facing: 3 },
      ],
      1,
    );
    const action = searchMachineAction(state, { depth: 1, budgetMs: 1_000 });

    expect(action).toMatchObject({ kind: 'move', pieceId: 'tank', to: { q: 0, r: 4 } });
    const after = applyAction(state, action!);
    expect(after.ok).toBe(true);
    expect(
      getAllLegalActions(after.state).some((reply) => {
        const outcome = applyAction(after.state, reply).state.outcome;
        return outcome?.type === 'win' && outcome.winner === 0;
      }),
    ).toBe(false);
  });

  it('recognizes a forced Fortress loss prepared by a quiet enemy rotation', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 2 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 1 },
        { id: 'p0', type: 'soldier', owner: 0, position: { q: -1, r: 5 }, facing: 5 },
        { id: 'p1', type: 'soldier', owner: 1, position: { q: 1, r: 3 }, facing: 0 },
        { id: 'p2', type: 'soldier', owner: 0, position: { q: -1, r: 4 }, facing: 3 },
        { id: 'p3', type: 'soldier', owner: 1, position: { q: -1, r: 1 }, facing: 3 },
        { id: 'p4', type: 'fast', owner: 0, position: { q: -2, r: 2 } },
        { id: 'p5', type: 'soldier', owner: 1, position: { q: 1, r: 0 }, facing: 2 },
      ],
      1,
    );
    const result = searchMachineActionWithMetadata(state, {
      depth: 2,
      budgetMs: 1_500,
      difficulty: 'expert',
      seed: 7,
    });
    // Previously this was only a material disadvantage (~ -8,000). Rotating
    // p0 toward the Fortress prepares a win against every available defense.
    expect(result.metadata.completedDepth).toBe(2);
    expect(result.metadata.score).toBeLessThan(-900_000);
    expect(getAllLegalActions(state)).toContainEqual(result.action);
  });

  it('keeps immediate wins across seeds instead of varying into a slower plan', () => {
    const state = createGameState(
      [
        { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 1 },
        { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 2 },
        { id: 'fast', type: 'fast', owner: 1, position: { q: 0, r: -2 } },
        { id: 'soldier', type: 'soldier', owner: 0, position: { q: 4, r: -1 }, facing: 3 },
      ],
      1,
    );
    for (let seed = 0; seed < 16; seed += 1) {
      const action = searchMachineAction(state, {
        depth: 2,
        budgetMs: 1_000,
        difficulty: 'expert',
        seed,
      });
      expect(action).not.toBeNull();
      expect(applyAction(state, action!).state.outcome).toEqual({
        type: 'win',
        winner: 1,
        reason: 'fortress',
      });
    }
  });

  it('keeps the last complete iteration when a deeper search runs out of time', () => {
    const state = createChoiceState();
    const options = { depth: 1, budgetMs: 1_000, difficulty: 'expert', seed: 13 } as const;
    const expected = searchMachineActionWithMetadata(state, options);
    let expired = false;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (expired ? 2_000 : 0));
    try {
      const result = searchMachineActionWithMetadata(state, {
        ...options,
        depth: 5,
        onProgress: ({ completedDepth }) => {
          if (completedDepth === 1) expired = true;
        },
      });
      expect(result.metadata).toMatchObject({
        completedDepth: 1,
        timedOut: true,
        score: expected.metadata.score,
      });
      expect(result.action).toEqual(expected.action);
    } finally {
      clock.mockRestore();
    }
  });
});
