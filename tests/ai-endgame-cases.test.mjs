import { describe, expect, it } from 'vitest';
import * as engine from '../src/engine';
import { createEndgameCases, proveEndgame } from '../scripts/ai/endgame-cases.mjs';

const cases = createEndgameCases(engine);
const entry = (id) => cases.find((position) => position.id === id);

describe('constructed exact endgames, before model evaluation', () => {
  it('groups related cannon variants instead of counting them as independent families', () => {
    expect(cases).toHaveLength(6);
    expect(new Set(cases.map((position) => position.family)).size).toBe(4);
    expect(new Set(cases.map((position) => position.id)).size).toBe(cases.length);
    for (const position of cases) {
      expect(engine.validateState(position.state)).toEqual([]);
      expect(position.partition).toBe('reserved');
      expect(
        new Set(
          cases
            .filter((sibling) => sibling.family === position.family)
            .map((sibling) => sibling.seed),
        ).size,
      ).toBe(1);
    }
  });

  it.each(cases)('proves $id within its horizon, but not two plies sooner', (position) => {
    const snapshot = JSON.stringify(position);
    const proof = proveEndgame(engine, position, { maxNodes: 10000 });
    const shorter = proveEndgame(
      engine,
      { ...position, proofHorizonPlies: position.proofHorizonPlies - 2 },
      { maxNodes: 10000 },
    );
    expect(proof).toMatchObject({ status: 'complete', forcedWin: true });
    expect(proof.immediateWins).toHaveLength(0);
    expect(proof.winningActions.length).toBeGreaterThan(0);
    expect(shorter).toMatchObject({ status: 'complete', forcedWin: false });
    expect(JSON.stringify(position)).toBe(snapshot);
  });

  it('retains all alternatives for the reorientation/transformation mate', () => {
    const position = entry('reorientation-or-transformation');
    const proof = proveEndgame(engine, position, { maxNodes: 10000 });
    expect(proof.winningActions.length).toBeGreaterThan(1);
    expect(proof.winningActions.some((action) => action.kind === 'orient')).toBe(true);
    expect(proof.winningActions.some((action) => action.kind === 'transform')).toBe(true);
  });

  it('verifies the two-missile mate against every legal opponent reply', () => {
    const position = entry('missile-two-hit-rim');
    const proof = proveEndgame(engine, position, { maxNodes: 10000 });
    expect(proof.winningActions).toEqual([{ kind: 'shoot', pieceId: 'launcher', targetId: 'f1' }]);
    const after = engine.applyAction(position.state, proof.winningActions[0], position.rules).state;
    expect(after.pieces.find((piece) => piece.id === 'launcher').missilesRemaining).toBe(1);
    for (const reply of engine.getAllLegalActions(after)) {
      const beforeLastShot = engine.applyAction(after, reply, position.rules).state;
      const final = engine.applyAction(beforeLastShot, proof.winningActions[0], position.rules);
      expect(final.ok).toBe(true);
      expect(final.state.outcome).toEqual({ type: 'win', winner: 0, reason: 'fortress' });
      expect(final.state.pieces.find((piece) => piece.id === 'launcher').missilesRemaining).toBe(0);
    }
  });

  it('certifies shield transfer without starting the aircraft inside an interception zone', () => {
    const position = entry('shield-transfer-air-ground');
    const plane = position.state.pieces.find((piece) => piece.id === 'plane');
    expect(engine.isProtectedByPlayer(position.state, plane.position, 1)).toBe(false);
    const proof = proveEndgame(engine, position, { maxNodes: 10000 });
    expect(proof.winningActions).toContainEqual({
      kind: 'convert',
      pieceId: 'capturer',
      targetId: 'enemy-shield',
    });
    const converted = engine.applyAction(
      position.state,
      { kind: 'convert', pieceId: 'capturer', targetId: 'enemy-shield' },
      position.rules,
    ).state;
    expect(converted.pieces.find((piece) => piece.id === 'enemy-shield').owner).toBe(0);
    expect(converted.pieces.some((piece) => piece.id === 'plane')).toBe(true);
  });

  it('keeps a depleted proof budget unknown, rather than calling it a failed mate', () => {
    const proof = proveEndgame(engine, entry('tank-three-hit-rim'), { maxNodes: 1 });
    expect(proof).toMatchObject({
      status: 'incomplete',
      forcedWin: null,
      winningActions: null,
      reason: 'proof-budget-exhausted',
    });
  });
});
