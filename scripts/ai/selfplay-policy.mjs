import { createHash } from 'node:crypto';

/** Separate training, play and evaluation streams; nesting additive seeds overlaps them. */
export function experimentSeed(seed, round, purpose, shard = 0) {
  return createHash('sha256')
    .update(JSON.stringify([seed, round, purpose, shard]))
    .digest()
    .readUInt32LE(0);
}

export function trainingTarget({
  teacher,
  teacherScore,
  baseline,
  outcome,
  outcomeWeight,
  residual,
  remainingPlies = 0,
  outcomeDecay = 0.98,
}) {
  const value =
    outcome === null ? teacher : (1 - outcomeWeight) * teacher + outcomeWeight * outcome;
  if (!residual) return value;
  // Search values and outcomes have different units. A result may add at most
  // outcomeWeight * 2000 points, discounted away from the actual end of the game.
  const score =
    teacherScore ?? Math.atanh(Math.max(-0.999999, Math.min(0.999999, teacher))) * 10000;
  const resultCorrection =
    outcome === null ? 0 : outcomeWeight * outcome * outcomeDecay ** Math.max(0, remainingPlies);
  return Math.max(-1, Math.min(1, (score - baseline) / 2000 + resultCorrection));
}

export function trainingDecision(report) {
  const loss = report.loss;
  return (
    report.bestEpoch > 0 &&
    Number.isFinite(loss?.validation) &&
    loss.validation < loss.initialValidation * 0.99 &&
    loss.validation < loss.zeroBaselineValidation * 0.99
  );
}

/** Stop a tournament as soon as even winning every remaining game cannot pass. */
export function promotionPossible(games, { pairs, minimumScore = 0.6, minimumCompletion = 0.8 }) {
  const total = pairs * 2;
  const remaining = Math.max(0, total - games.length);
  const completed = games.filter((game) => game.outcome).length;
  const points = games.reduce(
    (sum, game) =>
      sum +
      (!game.outcome
        ? 0
        : game.outcome.type === 'draw'
          ? 0.5
          : game.outcome.winner === game.neuralPlayer
            ? 1
            : 0),
    0,
  );
  return (
    completed + remaining >= Math.ceil(total * minimumCompletion) &&
    points + remaining >= total * minimumScore
  );
}

/** Conservative operational gate, not an Elo estimate or a statistical significance test. */
export function promotionDecision(report, { pairs, minimumScore = 0.6, minimumCompletion = 0.8 }) {
  const games = report.games ?? [];
  if (report.status !== 'complete' || games.length !== pairs * 2) return false;
  for (let pair = 1; pair <= pairs; pair += 1) {
    const group = games.filter((game) => game.pair === pair);
    if (
      group.length !== 2 ||
      new Set(group.map((game) => game.neuralPlayer)).size !== 2 ||
      !group.every((game) => game.neuralPlayer === 0 || game.neuralPlayer === 1)
    )
      return false;
  }
  let points = 0;
  let completed = 0;
  for (const game of games) {
    if (!game.outcome) continue;
    completed += 1;
    if (game.outcome.type === 'draw') points += 0.5;
    else if (game.outcome.type === 'win' && game.outcome.winner === game.neuralPlayer) points += 1;
  }
  // Unfinished games earn no points and remain in the denominator.
  return (
    pairs >= 8 &&
    completed / games.length >= minimumCompletion &&
    points / games.length >= minimumScore
  );
}
