import { calculateElo, type PlayerProgression, type ProgressionMode } from './progression.js';

/** Only completed matches contribute; legacy matches without results remain unclassified. */
export function playerStatistics(progress: PlayerProgression, mode?: ProgressionMode) {
  const matches = Object.values(progress.matches).filter(
    (match) => match.completedAt && (mode === undefined || match.mode === mode),
  );
  const wins = matches.filter((match) => match.result === 1).length;
  return {
    played: matches.length,
    wins,
    draws: matches.filter((match) => match.result === 0.5).length,
    losses: matches.filter((match) => match.result === 0).length,
    winPercentage: matches.length ? (100 * wins) / matches.length : 0,
  };
}

export function playerRecords(progress: PlayerProgression, mode: 'machine' | 'online') {
  const matches = Object.values(progress.matches)
    .filter((match) => match.mode === mode && match.completedAt)
    .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!));
  let rating = 1000;
  let bestRating = Math.max(1000, progress.ratings[mode]);
  let streak = 0;
  let bestStreak = 0;
  let ratedMatches = 0;
  matches.forEach((match) => {
    if (match.result !== undefined && match.rated !== false) {
      rating =
        match.battle?.ratingAfter ??
        calculateElo(rating, match.opponentRating ?? 1000, match.result, ratedMatches);
      ratedMatches++;
      bestRating = Math.max(bestRating, rating);
    }
    streak = match.result === 1 ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
  });
  // A browser-local profile cannot establish a position in a shared leaderboard.
  return { bestRating, bestStreak, monthlyPosition: null, historicalPosition: null };
}
