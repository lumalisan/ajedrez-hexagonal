import { describe, expect, it } from 'vitest';
import * as engine from '../src/engine';
import {
  assessBenchmarkAction,
  createBenchmarkCases,
  objectiveStrength,
  validateBenchmarkCases,
} from '../scripts/ai/benchmark-cases.mjs';
import { summarizeBenchmarkRows } from '../scripts/ai/benchmark.mjs';

const cases = createBenchmarkCases(engine);
const entry = (id) => cases.find((candidate) => candidate.id === id);

describe('public engine benchmark bank', () => {
  it('contains distinct valid, discriminating cases and keeps related families together', () => {
    const snapshot = JSON.stringify(cases);
    const smallPositions = cases.filter((value) => !value.id.startsWith('recorded-'));
    const validation = validateBenchmarkCases(engine, smallPositions, { exhaustive: true });
    expect(validation).toHaveLength(15);
    expect(validation.every((value) => value.exhaustive)).toBe(true);
    expect(cases).toHaveLength(19);
    expect(new Set(cases.map((value) => value.family)).size).toBe(16);
    expect(new Set(cases.map((value) => value.category)).size).toBe(10);
    expect(cases.every((value) => value.provenance.includes('public'))).toBe(true);
    expect(cases.filter((value) => value.objectiveStrength === 'tactical-proof')).toHaveLength(13);
    expect(entry('tank-create-firing-line').objectiveStrength).toBe('strategic-preference');
    expect(objectiveStrength({ kind: 'win-now' })).toBe('tactical-proof');
    for (const position of cases) {
      expect(engine.validateState(position.state)).toEqual([]);
      expect(position.state.outcome).toBeNull();
      const siblings = cases.filter((value) => value.family === position.family);
      expect(new Set(siblings.map((value) => value.partition)).size).toBe(1);
    }
    expect(JSON.stringify(cases)).toBe(snapshot);
  });

  it.each(cases.filter((value) => value.id.startsWith('recorded-')))(
    'retains real accepted and rejected witnesses without mutating $id',
    (position) => {
      const snapshot = JSON.stringify(position);
      const actorIds = new Set(
        position.state.pieces
          .filter(
            (piece) =>
              piece.owner === position.state.activePlayer && piece.type === position.objective.type,
          )
          .map((piece) => piece.id),
      );
      const legal = engine
        .getAllLegalActions(position.state)
        .sort(
          (left, right) => Number(actorIds.has(right.pieceId)) - Number(actorIds.has(left.pieceId)),
        );
      let accepted = null;
      let rejected = null;
      for (const action of legal) {
        const assessment = assessBenchmarkAction(engine, position, action);
        expect(assessment.legal).toBe(true);
        if (assessment.success) accepted ??= action;
        else rejected ??= action;
        if (accepted && rejected) break;
      }
      expect(accepted).not.toBeNull();
      expect(rejected).not.toBeNull();
      expect(engine.applyAction(position.state, accepted, position.rules).ok).toBe(true);
      expect(engine.applyAction(position.state, rejected, position.rules).ok).toBe(true);
      expect(position.category).toBe(
        position.objective.type === 'fast' ? 'capturas-envenenadas' : 'orientacion',
      );
      expect(JSON.stringify(position)).toBe(snapshot);
    },
  );

  it('accepts a Fortress sacrifice only when the engine establishes the terminal win', () => {
    const position = entry('fast-terminal');
    const legal = engine.getAllLegalActions(position.state);
    const wins = legal.filter((action) => assessBenchmarkAction(engine, position, action).success);
    expect(wins).toHaveLength(1);
    const after = engine.applyAction(position.state, wins[0], position.rules).state;
    expect(after.outcome).toEqual({ type: 'win', winner: 1, reason: 'fortress' });
    expect(after.pieces.some((piece) => piece.id === 'fast')).toBe(false);
    expect(
      assessBenchmarkAction(
        engine,
        position,
        legal.find((action) => action !== wins[0]),
      ).success,
    ).toBe(false);
  });

  it('accepts multiple defenses when each prevents every immediate losing reply', () => {
    const position = entry('quiet-fortress-block');
    const actions = engine.getAllLegalActions(position.state);
    const saves = actions.filter(
      (action) => assessBenchmarkAction(engine, position, action).success,
    );
    expect(saves.length).toBeGreaterThan(1);
    expect(saves.length).toBeLessThan(actions.length);
    const block = { kind: 'move', pieceId: 'tank', to: { q: 0, r: 4 }, cannon: 2 };
    const equivalentBlock = actions.find(
      (action) =>
        action.kind === block.kind &&
        action.pieceId === block.pieceId &&
        action.to.q === 0 &&
        action.to.r === 4,
    );
    expect(assessBenchmarkAction(engine, position, equivalentBlock)).toMatchObject({
      legal: true,
      success: true,
    });
  });

  it('rejects an intercepted flight even when the order is legal', () => {
    const position = entry('aircraft-interception-en-route');
    const action = { kind: 'move', pieceId: 'plane', to: { q: 2, r: 0 } };
    expect(
      engine
        .applyAction(position.state, action, position.rules)
        .events.some((event) => event.type === 'intercept'),
    ).toBe(true);
    expect(assessBenchmarkAction(engine, position, action)).toMatchObject({
      legal: true,
      success: false,
    });
    expect(assessBenchmarkAction(engine, position, { ...action, to: { q: 5, r: 5 } }).legal).toBe(
      false,
    );
  });

  it('rejects the poisoned capture by observing the actual recapture or conversion', () => {
    const position = entry('poisoned-fast-capture');
    const bait = engine
      .getAllLegalActions(position.state)
      .find(
        (action) =>
          action.kind === 'move' &&
          action.pieceId === 'fast' &&
          action.to.q === 0 &&
          action.to.r === -2,
      );
    expect(assessBenchmarkAction(engine, position, bait)).toMatchObject({
      legal: true,
      success: false,
    });
  });

  it('uses ownership after conversion rather than an exact action string', () => {
    const position = entry('convert-loaded-not-empty');
    const take = { kind: 'convert', pieceId: 'capturer', targetId: 'loaded' };
    const after = engine.applyAction(position.state, take, position.rules).state;
    expect(after.pieces.find((piece) => piece.id === 'loaded')).toMatchObject({
      owner: 1,
      missilesRemaining: 2,
    });
    expect(assessBenchmarkAction(engine, position, take)).toMatchObject({
      legal: true,
      success: true,
    });
    expect(assessBenchmarkAction(engine, position, { ...take, targetId: 'empty' }).success).toBe(
      false,
    );
  });

  it('rejects a family spread across both partitions', () => {
    const original = entry('soldier-terminal');
    const sibling = entry('capturer-terminal');
    expect(() =>
      validateBenchmarkCases(engine, [original, { ...sibling, partition: 'reserved' }]),
    ).toThrow('Familia dividida');
  });

  it('keeps measurement errors separate from quality failures and reports family balance', () => {
    const rows = [
      {
        evaluator: 'champion',
        family: 'one',
        category: 'capture',
        legal: true,
        success: true,
        nodes: 100,
        elapsedMs: 20,
        completedDepth: 2,
      },
      {
        evaluator: 'champion',
        family: 'one',
        category: 'capture',
        legal: true,
        success: true,
        nodes: 100,
        elapsedMs: 20,
        completedDepth: 2,
      },
      {
        evaluator: 'champion',
        family: 'two',
        category: 'defense',
        legal: true,
        success: false,
        nodes: 50,
        elapsedMs: 10,
        completedDepth: 0,
      },
      { evaluator: 'champion', family: 'three', category: 'defense', error: 'interrupted' },
    ];
    expect(summarizeBenchmarkRows(rows).champion).toMatchObject({
      cases: 4,
      measured: 3,
      errors: 1,
      successes: 2,
      failures: 1,
      accuracy: 2 / 3,
      familyMeanAccuracy: 0.5,
      depthZero: 1,
      nodes: 250,
      elapsedMs: 50,
      nodesPerSecond: 5000,
    });
  });

  it('separates local tactical checks from strategic preferences in report summaries', () => {
    const rows = [
      {
        evaluator: 'candidate',
        family: 'terminal',
        category: 'win',
        objectiveStrength: 'tactical-proof',
        legal: true,
        success: true,
        nodes: 1,
        elapsedMs: 1,
        completedDepth: 1,
      },
      {
        evaluator: 'candidate',
        family: 'line',
        category: 'orientation',
        objectiveStrength: 'strategic-preference',
        legal: true,
        success: false,
        nodes: 1,
        elapsedMs: 1,
        completedDepth: 1,
      },
    ];
    const summary = summarizeBenchmarkRows(rows).candidate;
    expect(summary.accuracy).toBe(0.5);
    expect(summary.verified).toMatchObject({ cases: 1, successes: 1, accuracy: 1 });
    expect(summary.preferences).toMatchObject({ cases: 1, failures: 1, accuracy: 0 });
  });
});
