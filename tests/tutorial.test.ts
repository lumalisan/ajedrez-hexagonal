import { describe, expect, it } from 'vitest';
import { actionKey } from '../src/action-identity';
import { applyAction, getLegalActionsForPiece, occupancyAt, validateState } from '../src/engine';
import {
  createTutorialCheckpoint,
  getTutorialActions,
  getTutorialReply,
  nextTutorialSection,
  TUTORIAL_STEPS,
} from '../src/tutorial';
import type { GameAction, GameState } from '../src/types';

const indexOf = (id: string): number => TUTORIAL_STEPS.findIndex((step) => step.id === id);

function perform(state: GameState, action: GameAction): GameState {
  const before = structuredClone(state);
  expect(getLegalActionsForPiece(state, action.pieceId).map(actionKey)).toContain(
    actionKey(action),
  );
  const result = applyAction(state, action, { repetition: null, noProgressPlyLimit: null });
  expect(result.ok, result.error).toBe(true);
  expect(state).toEqual(before);
  return { ...result.state, activePlayer: 0 };
}

describe('tutorial checkpoints', () => {
  it('reconstructs every exercise using legal actions, with fresh valid states', () => {
    expect(TUTORIAL_STEPS).toHaveLength(37);
    for (const [index, step] of TUTORIAL_STEPS.entries()) {
      const checkpoint = createTutorialCheckpoint(index);
      expect(validateState(checkpoint.state), step.id).toEqual([]);
      expect(checkpoint.state.activePlayer, step.id).toBe(0);
      expect(checkpoint.state.outcome, step.id).toBeNull();
      expect(createTutorialCheckpoint(index)).toEqual(checkpoint);
      expect(createTutorialCheckpoint(index).state).not.toBe(checkpoint.state);
      const actions = getTutorialActions(checkpoint.state, index);
      if (['action', 'prepare', 'free'].includes(step.interaction)) {
        expect(actions.length, `Actions for ${step.id}`).toBeGreaterThan(0);
        for (const action of actions) perform(checkpoint.state, action);
      } else {
        expect(actions).toEqual([]);
      }
    }
  });

  it('uses the illustrated formations and north facing from Cian perspective', () => {
    const { state } = createTutorialCheckpoint(0);
    expect(state.pieces).toHaveLength(21);
    expect(state.pieces.find((piece) => piece.id === 'tutorial-cian-soldier')).toMatchObject({
      position: { q: 4, r: -4 },
      facing: 3,
    });
    expect(state.pieces.find((piece) => piece.id === 'tutorial-cian-airplane')).toMatchObject({
      position: { q: -2, r: -3 },
      facing: 3,
    });
    const shared = createTutorialCheckpoint(indexOf('10.1')).state;
    for (const target of [
      { q: 3, r: -1 },
      { q: 0, r: 0 },
      { q: -3, r: 2 },
    ]) {
      expect(occupancyAt(shared, target).ground?.owner).toBe(1);
      expect(occupancyAt(shared, target).air?.owner).toBe(1);
    }
    const siege = createTutorialCheckpoint(indexOf('12.1'));
    expect(siege.selectedId).toBe('tutorial-cian-airplane');
    expect(occupancyAt(siege.state, { q: 0, r: 4 }).ground).toMatchObject({
      type: 'fortress',
      hp: 2,
    });
    expect(createTutorialCheckpoint(indexOf('14.1')).state).toEqual(state);
  });

  it('prepares movement without consuming it, and leaves the tank orientation to the learner', () => {
    const soldier = createTutorialCheckpoint(indexOf('3.2'));
    expect(soldier.pendingAction).toEqual({
      kind: 'move',
      pieceId: 'tutorial-cian-soldier',
      to: { q: 4, r: -3 },
    });
    expect(occupancyAt(soldier.state, { q: 4, r: -4 }).ground?.id).toBe('tutorial-cian-soldier');
    const tank = createTutorialCheckpoint(indexOf('5.2'));
    expect(tank.pendingAction).toMatchObject({ kind: 'move', to: { q: 0, r: -1 }, cannon: 3 });
    expect(getTutorialActions(tank.state, indexOf('5.2'))).toEqual([
      { kind: 'move', pieceId: 'tutorial-cian-medium', to: { q: 0, r: -1 }, cannon: 4 },
    ]);
  });

  it('skips to the first exercise of the previous or next section', () => {
    expect(nextTutorialSection(indexOf('3.1'), 1)).toBe(indexOf('4.1'));
    expect(nextTutorialSection(indexOf('3.4'), 1)).toBe(indexOf('4.1'));
    expect(nextTutorialSection(indexOf('4.2'), -1)).toBe(indexOf('3.1'));
    expect(nextTutorialSection(0, -1)).toBe(0);
    expect(nextTutorialSection(indexOf('14.1'), 1)).toBe(indexOf('14.1'));
    expect(() => createTutorialCheckpoint(-1)).toThrow(RangeError);
    expect(() => createTutorialCheckpoint(37)).toThrow(RangeError);
  });

  it('moves only the scripted Amber unit in each reply', () => {
    const expectedReplies = ['3.2', '4.1', '4.2', '5.4', '6.1', '6.2', '8.1', '9.1', '9.2'];
    for (const [index, step] of TUTORIAL_STEPS.entries()) {
      if (step.interaction !== 'action') continue;
      const { state } = createTutorialCheckpoint(index);
      const next = perform(state, getTutorialActions(state, index)[0]);
      const before = structuredClone(next);
      const reply = getTutorialReply(next, index);
      expect(next).toEqual(before);
      if (expectedReplies.includes(step.id)) {
        expect(reply, step.id).not.toBeNull();
        perform({ ...next, activePlayer: 1 }, reply!);
      } else {
        expect(reply, step.id).toBeNull();
      }
    }
  });
});

describe('tutorial exercises', () => {
  it('allows all three ground choices and preserves the aerial target for the later exercise', () => {
    const startIndex = indexOf('10.3');
    const { state } = createTutorialCheckpoint(startIndex);
    const choices = getTutorialActions(state, startIndex);
    expect(new Set(choices.map((action) => action.pieceId))).toEqual(
      new Set(['tutorial-cian-soldier', 'tutorial-cian-fast', 'tutorial-cian-capturer']),
    );
    for (const choice of choices) {
      let next = perform(state, choice);
      expect(occupancyAt(next, { q: 3, r: -1 }).ground?.owner).toBe(0);
      expect(occupancyAt(next, { q: 3, r: -1 }).air?.owner).toBe(1);
      next = perform(next, getTutorialActions(next, indexOf('10.4'))[0]);
      for (const rangedChoice of getTutorialActions(next, indexOf('10.5'))) {
        let branch = perform(next, rangedChoice);
        branch = perform(branch, getTutorialActions(branch, indexOf('11.1'))[0]);
        const upperAttacks = getTutorialActions(branch, indexOf('11.2'));
        expect(upperAttacks).toHaveLength(1);
        expect(upperAttacks[0].pieceId).toBe(occupancyAt(branch, { q: 3, r: -1 }).ground?.id);
        const final = perform(branch, upperAttacks[0]);
        expect(occupancyAt(final, { q: 3, r: -1 }).air?.owner).not.toBe(1);
      }
    }
  });

  it('lets each ranged unit hit either shared target while preserving the other', () => {
    const index = indexOf('10.5');
    const { state } = createTutorialCheckpoint(index);
    const actions = getTutorialActions(state, index);
    expect(new Set(actions.map((action) => action.pieceId))).toEqual(
      new Set(['tutorial-cian-medium', 'tutorial-cian-long', 'tutorial-cian-airplane']),
    );
    for (const pieceId of [
      'tutorial-cian-medium',
      'tutorial-cian-long',
      'tutorial-cian-airplane',
    ]) {
      expect(
        actions.filter((action) => action.pieceId === pieceId && action.kind === 'shoot'),
      ).toHaveLength(2);
    }
    expect(actions.filter((action) => action.kind === 'move' && action.kamikaze)).toHaveLength(2);
    for (const action of actions) {
      const next = perform(state, action);
      const remainingEnemies = next.pieces.filter(
        (piece) =>
          piece.owner === 1 &&
          ['tutorial-shared-ground-right', 'tutorial-shared-air-right'].includes(piece.id),
      );
      expect(remainingEnemies).toHaveLength(1);
    }
  });

  it('consumes both missiles and transforms the empty launcher in one action', () => {
    const index = indexOf('6.4');
    const { state } = createTutorialCheckpoint(index);
    expect(state.pieces.find((piece) => piece.id === 'tutorial-cian-long')).toMatchObject({
      missilesRemaining: 0,
    });
    const actions = getTutorialActions(state, index);
    expect(actions).toEqual([
      { kind: 'transform', pieceId: 'tutorial-cian-long', facing: 4, to: { q: -3, r: 1 } },
    ]);
    const next = perform(state, actions[0]);
    expect(next.pieces.find((piece) => piece.id === 'tutorial-cian-long')).toMatchObject({
      type: 'soldier',
      position: { q: -3, r: 1 },
      facing: 4,
    });
  });

  it('intercepts the drone along its path, sacrifices the rammer, and allows both final plane attacks', () => {
    const interceptIndex = indexOf('12.2');
    const { state } = createTutorialCheckpoint(interceptIndex);
    const result = applyAction(state, getTutorialActions(state, interceptIndex)[0]);
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'intercept', at: { q: 1, r: 4 } }),
    );
    expect(result.state.pieces.some((piece) => piece.id === 'tutorial-cian-drone')).toBe(false);
    const finalIndex = indexOf('13.2');
    const finalState = createTutorialCheckpoint(finalIndex).state;
    expect(finalState.pieces.some((piece) => piece.id === 'tutorial-cian-fast')).toBe(false);
    expect(occupancyAt(finalState, { q: 0, r: 4 }).ground).toMatchObject({
      type: 'fortress',
      hp: 1,
    });
    const attacks = getTutorialActions(finalState, finalIndex);
    expect(attacks.map((action) => action.kind).sort()).toEqual(['move', 'shoot']);
    for (const action of attacks) {
      expect(perform(finalState, action).outcome).toEqual({
        type: 'win',
        winner: 0,
        reason: 'fortress',
      });
    }
  });

  it('allows the entire Cian legal action set during free practice and blocks Amber', () => {
    const index = indexOf('14.1');
    const { state } = createTutorialCheckpoint(index);
    const allCian = state.pieces
      .filter((piece) => piece.owner === 0)
      .flatMap((piece) => getLegalActionsForPiece(state, piece.id));
    expect(getTutorialActions(state, index).map(actionKey)).toEqual(allCian.map(actionKey));
    expect(getTutorialActions({ ...state, activePlayer: 1 }, index)).toEqual([]);
    expect(getTutorialReply(state, index)).toBeNull();
  });
});
