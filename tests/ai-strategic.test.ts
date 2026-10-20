import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { actionKey } from '../src/action-identity';
import { searchMachineActionWithMetadata } from '../src/ai';
import { createNeuralEvaluator } from '../src/ai-neural';
import { applyAction, createGameState, getAllLegalActions, validateState } from '../src/engine';
import type { ActionResolutionRules } from '../src/engine';
import type { GameAction, GameState } from '../src/types';

interface StrategicCase {
  id: string;
  state: GameState;
  rules: ActionResolutionRules;
  recordedAction: GameAction;
  seed: number;
}
const fixture: { cases: StrategicCase[] } = JSON.parse(
  readFileSync(new URL('./fixtures/ai-strategic-positions.json', import.meta.url), 'utf8'),
);
const bytes = readFileSync(new URL('../src/ai-models/hex-value.bin', import.meta.url));
const evaluate = createNeuralEvaluator(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);

function exposedUnits(
  state: GameState,
  owner: 0 | 1,
  type: 'fast' | 'airplane',
  rules: ActionResolutionRules,
) {
  if (state.outcome || state.activePlayer === owner) return [];
  const units = state.pieces.filter((piece) => piece.owner === owner && piece.type === type);
  return units.filter((piece) =>
    getAllLegalActions(state).some((action) => {
      const reply = applyAction(state, action, rules);
      return (
        reply.ok &&
        !reply.state.pieces.some(
          (remaining) => remaining.id === piece.id && remaining.owner === owner,
        )
      );
    }),
  );
}

describe('strategic decisions from recorded matches', () => {
  it('retains legal positions and the original game rules', () => {
    for (const entry of fixture.cases) {
      expect(validateState(entry.state)).toEqual([]);
      expect(applyAction(entry.state, entry.recordedAction, entry.rules).ok).toBe(true);
    }
  });

  for (const kind of ['expert', 'neural'] as const) {
    it(`${kind} moves the Caza out of an attack while preserving room to manoeuvre`, () => {
      const entry = fixture.cases.find((candidate) => candidate.id === 'plane-expert-heading')!;
      const result = searchMachineActionWithMetadata(entry.state, {
        difficulty: 'expert',
        depth: 1,
        budgetMs: 1000,
        seed: entry.seed,
        resolutionRules: entry.rules,
        ...(kind === 'neural' ? { evaluate } : {}),
      });
      const after = applyAction(entry.state, result.action!, entry.rules);
      expect(after.ok).toBe(true);
      expect(result.action?.pieceId).toBe('ambar-airplane-17');
      expect(
        exposedUnits(after.state, entry.state.activePlayer, 'airplane', entry.rules),
      ).toHaveLength(0);
      const plane = after.state.pieces.find((piece) => piece.id === 'ambar-airplane-17')!;
      expect(plane.position).not.toEqual({ q: -5, r: 4 });
    });
    it.each(['fast-expert-drone', 'fast-neural-tank', 'fast-neural-tank-second'])(
      `${kind} avoids the recorded poisoned Embestidor capture even with no completed iteration: %s`,
      (id) => {
        const entry = fixture.cases.find((candidate) => candidate.id === id)!;
        const snapshot = JSON.stringify(entry.state);
        const recorded = applyAction(entry.state, entry.recordedAction, entry.rules);
        expect(
          exposedUnits(recorded.state, entry.state.activePlayer, 'fast', entry.rules).length,
        ).toBeGreaterThan(0);
        const result = searchMachineActionWithMetadata(entry.state, {
          difficulty: 'expert',
          depth: 3,
          budgetMs: 1,
          seed: entry.seed,
          resolutionRules: entry.rules,
          ...(kind === 'neural' ? { evaluate } : {}),
        });
        expect(result.metadata.completedDepth).toBe(0);
        expect(result.action).not.toBeNull();
        expect(actionKey(result.action!)).not.toBe(actionKey(entry.recordedAction));
        const after = applyAction(entry.state, result.action!, entry.rules);
        expect(after.ok).toBe(true);
        expect(
          exposedUnits(after.state, entry.state.activePlayer, 'fast', entry.rules),
        ).toHaveLength(0);
        expect(JSON.stringify(entry.state)).toBe(snapshot);
      },
    );

    it(`${kind} still sacrifices an Embestidor to win immediately`, () => {
      const state = createGameState(
        [
          { id: 'f0', type: 'fortress', owner: 0, position: { q: 0, r: -5 }, hp: 1 },
          { id: 'f1', type: 'fortress', owner: 1, position: { q: 0, r: 5 }, hp: 1 },
          { id: 'fast', type: 'fast', owner: 1, position: { q: 0, r: -3 } },
        ],
        1,
      );
      const result = searchMachineActionWithMetadata(state, {
        difficulty: 'expert',
        depth: 1,
        budgetMs: 1000,
        ...(kind === 'neural' ? { evaluate } : {}),
      });
      expect(applyAction(state, result.action!).state.outcome).toEqual({
        type: 'win',
        winner: 1,
        reason: 'fortress',
      });
    });
  }
});
