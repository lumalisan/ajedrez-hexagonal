import { describe, expect, it } from 'vitest';
import {
  experimentSeed,
  promotionDecision,
  promotionPossible,
  trainingDecision,
  trainingTarget,
} from '../scripts/ai/selfplay-policy.mjs';

describe('self-play learning data', () => {
  it('separates generation, training and evaluation streams across rounds and shards', () => {
    const seeds = [];
    for (let round = 0; round < 10; round += 1) {
      for (const purpose of ['play', 'train', 'evaluation']) {
        for (let shard = 0; shard < 24; shard += 2) {
          seeds.push(experimentSeed(1, round, purpose, shard));
        }
      }
    }
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(experimentSeed(1, 0, 'play')).toBe(experimentSeed(1, 0, 'play'));
  });
  it('uses real outcomes without manufacturing an outcome for unfinished games', () => {
    const sample = { teacher: 0.2, baseline: 0, outcomeWeight: 0.25, residual: false };
    expect(trainingTarget({ ...sample, outcome: null })).toBe(0.2);
    expect(trainingTarget({ ...sample, outcome: 1 })).toBeCloseTo(0.4);
    expect(trainingTarget({ ...sample, outcome: 0 })).toBeCloseTo(0.15);
    expect(trainingTarget({ ...sample, outcome: -1 })).toBeCloseTo(-0.1);
  });
  it('learns a bounded correction, retaining opposite targets for opposite perspectives', () => {
    const sample = { teacher: 0.1, baseline: 500, outcome: 1, outcomeWeight: 0.25, residual: true };
    const positive = trainingTarget(sample);
    expect(positive).toBeGreaterThan(0);
    expect(trainingTarget({ ...sample, teacher: -0.1, baseline: -500, outcome: -1 })).toBe(
      -positive,
    );
    expect(trainingTarget({ ...sample, teacher: 1 })).toBe(1);
    expect(trainingTarget({ ...sample, teacher: -1, outcome: -1 })).toBe(-1);
    expect(
      trainingTarget({ ...sample, teacher: Math.tanh(500 / 10000), outcome: null }),
    ).toBeCloseTo(0);
  });
  it('limits result influence to 500 points and discounts early positions', () => {
    const sample = {
      teacher: 0,
      teacherScore: 500,
      baseline: 500,
      outcome: 1,
      outcomeWeight: 0.25,
      residual: true,
    };
    expect(trainingTarget(sample)).toBeCloseTo(0.25);
    expect(trainingTarget({ ...sample, remainingPlies: 100 })).toBeCloseTo(0.25 * 0.98 ** 100);
    expect(trainingTarget({ ...sample, outcome: null })).toBe(0);
    expect(trainingTarget({ ...sample, teacher: 1, teacherScore: 0, baseline: 0 })).toBe(0.25);
  });
  it('requires learned validation improvement before spending time on tournaments', () => {
    const report = {
      bestEpoch: 3,
      loss: { validation: 0.0151, initialValidation: 0.0155, zeroBaselineValidation: 0.0206 },
    };
    expect(trainingDecision(report)).toBe(true);
    expect(trainingDecision({ ...report, bestEpoch: 0 })).toBe(false);
    expect(trainingDecision({ ...report, loss: { ...report.loss, validation: 0.01549 } })).toBe(
      false,
    );
    expect(
      trainingDecision({ ...report, loss: { ...report.loss, zeroBaselineValidation: 0.01 } }),
    ).toBe(false);
  });
});

function arena(wins, losses, draws = 0, unfinished = 0) {
  const outcomes = [
    ...Array(wins).fill('win'),
    ...Array(losses).fill('loss'),
    ...Array(draws).fill('draw'),
    ...Array(unfinished).fill(null),
  ];
  return {
    status: 'complete',
    games: outcomes.map((result, index) => {
      const neuralPlayer = index % 2;
      return {
        pair: Math.floor(index / 2) + 1,
        neuralPlayer,
        outcome:
          result === null
            ? null
            : result === 'draw'
              ? { type: 'draw' }
              : {
                  type: 'win',
                  winner: result === 'win' ? neuralPlayer : 1 - neuralPlayer,
                },
      };
    }),
  };
}

describe('self-play champion promotion', () => {
  it('stops mathematically hopeless tournaments but retains recoverable ones', () => {
    expect(promotionPossible(arena(0, 0, 0, 3).games, { pairs: 8 })).toBe(true);
    expect(promotionPossible(arena(0, 0, 0, 4).games, { pairs: 8 })).toBe(false);
    expect(promotionPossible(arena(0, 7).games, { pairs: 8 })).toBe(false);
    expect(promotionPossible(arena(0, 7).games, { pairs: 8, minimumScore: 0.5 })).toBe(true);
  });
  it('requires a completed paired tournament with enough wins', () => {
    expect(promotionDecision(arena(10, 6), { pairs: 8 })).toBe(true);
    expect(promotionDecision(arena(9, 7), { pairs: 8 })).toBe(false);
    expect(promotionDecision(arena(8, 8), { pairs: 8, minimumScore: 0.5 })).toBe(true);
    expect(promotionDecision(arena(2, 0), { pairs: 1 })).toBe(false);
  });
  it('never turns unfinished games into draws or hides them from the denominator', () => {
    expect(promotionDecision(arena(8, 5, 0, 3), { pairs: 8 })).toBe(false);
    expect(promotionDecision(arena(12, 0, 0, 4), { pairs: 8 })).toBe(false);
    expect(promotionDecision(arena(10, 3, 0, 3), { pairs: 8 })).toBe(true);
    expect(promotionDecision(arena(8, 4, 4), { pairs: 8 })).toBe(true);
  });
  it('rejects interrupted tournaments and missing or duplicate sides', () => {
    const report = arena(16, 0);
    report.status = 'failed';
    expect(promotionDecision(report, { pairs: 8 })).toBe(false);
    report.status = 'complete';
    report.games[0].neuralPlayer = 1;
    expect(promotionDecision(report, { pairs: 8 })).toBe(false);
    expect(promotionDecision(arena(14, 0), { pairs: 8 })).toBe(false);
  });
});
