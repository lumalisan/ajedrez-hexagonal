import { describe, expect, it } from 'vitest';
import { assessPairedArena, pairedBettingEvidence } from '../scripts/ai/paired-evaluation.mjs';

function arena(pairs, result) {
  return {
    status: 'complete',
    settings: { pairs },
    games: Array.from({ length: pairs * 2 }, (_, index) => ({
      pair: Math.floor(index / 2) + 1,
      neuralPlayer: index % 2,
      outcome:
        result === null ? null : { type: 'win', winner: result ? index % 2 : 1 - (index % 2) },
    })),
  };
}

describe('opening-pair evidence', () => {
  it('requires substantial paired evidence even when a tiny sample wins every game', () => {
    expect(assessPairedArena(arena(8, true)).decision).toBe('insufficient-evidence');
    const result = assessPairedArena(arena(100, true));
    expect(result.decision).toBe('evidence-of-improvement');
    expect(result.promotionAllowed).toBe(false);
  });
  it('keeps unfinished results as uncertainty instead of wins, losses or draws', () => {
    const result = assessPairedArena(arena(100, null));
    expect(result.scoreBounds).toEqual([0, 1]);
    expect(result.observedScore).toBeNull();
    expect(result.decision).toBe('insufficient-evidence');
  });
  it('does not use an unpaired game and rejects duplicate sides', () => {
    const report = arena(2, true);
    report.games.pop();
    expect(assessPairedArena(report).unpairedGames).toBe(1);
    report.games[1].neuralPlayer = report.games[0].neuralPlayer;
    expect(() => assessPairedArena(report)).toThrow(/duplicado/);
  });
  it('recognizes regression and retains a neutral match as inconclusive', () => {
    expect(assessPairedArena(arena(100, false)).decision).toBe('evidence-of-regression');
    const report = arena(100, true);
    for (const game of report.games) game.outcome = { type: 'draw' };
    expect(assessPairedArena(report).decision).toBe('inconclusive');
  });

  it('uses a predeclared betting test to detect paired gains without treating neutral pairs as noise', () => {
    const neutral = Array.from({ length: 100 }, () => ({ lower: 0.5, upper: 0.5 }));
    expect(pairedBettingEvidence(neutral).improvement).toBe(false);
    const improved = neutral.map((entry, index) => (index < 12 ? { lower: 1, upper: 1 } : entry));
    expect(pairedBettingEvidence(improved).improvement).toBe(true);
    expect(pairedBettingEvidence(improved).regression).toBe(false);
    const censored = neutral.map((entry, index) => (index < 12 ? { lower: 0, upper: 1 } : entry));
    expect(pairedBettingEvidence(censored).improvement).toBe(false);
    expect(pairedBettingEvidence(censored).regression).toBe(false);
  });

  it('keeps betting capital calibrated in expectation under a fair paired null', () => {
    let expectation = 0;
    for (let bits = 0; bits < 256; bits += 1) {
      const observations = Array.from({ length: 8 }, (_, index) => {
        const value = Number(Boolean(bits & (1 << index)));
        return { lower: value, upper: value };
      });
      expectation += Math.exp(pairedBettingEvidence(observations).logEvidenceImprovement) / 256;
    }
    expect(expectation).toBeCloseTo(1, 12);
  });

  it('does not inspect fast finished pairs ahead of a missing earlier pair', () => {
    const report = arena(100, true);
    report.games = report.games.filter((game) => game.pair !== 1);
    const result = assessPairedArena(report, { method: 'betting' });
    expect(result.observedPairs).toBe(0);
    expect(result.gamesOutsideCompletedPrefix).toBe(198);
    expect(result.decision).toBe('insufficient-evidence');
  });
});
