import { replayRecord } from '../src/match-record.js';
import {
  evaluateProgressionMatch,
  registerProgressionMatch,
  type PlayerProgression,
} from '../src/progression.js';
import type { Player } from '../src/types.js';
import type { OnlineMatch } from './repository.js';

export function reconcileOnlineProgression(
  progress: PlayerProgression,
  matches: OnlineMatch[],
  accountId: string,
): PlayerProgression {
  const completedAt = (match: OnlineMatch) =>
    match.rankingResult?.completedAt ?? match.privateResult?.completedAt ?? match.record.updatedAt;
  for (const match of [...matches].sort((a, b) => completedAt(a).localeCompare(completedAt(b)))) {
    const side = match.players.indexOf(accountId);
    if (side === -1) continue;
    const owner = side as Player;
    const { record } = match;
    const savedResult = match.rankingResult ?? match.privateResult;
    const outcome = savedResult
      ? null
      : (record.conclusion?.outcome ?? replayRecord(record).outcome);
    const score =
      savedResult?.score ??
      (outcome?.type === 'draw'
        ? 0.5
        : outcome?.type === 'win'
          ? Number(outcome.winner === 0)
          : null);
    if (score === null) continue;
    if (!progress.matches[record.createdAt]?.completedAt) {
      progress = evaluateProgressionMatch(registerProgressionMatch(progress, record), record, {
        source: 'live',
        onlinePlayer: owner,
        at: completedAt(match),
      }).progress;
    }
    const evidence = progress.matches[record.createdAt];
    if (evidence?.mode !== 'online' || !evidence.completedAt) continue;
    evidence.result = (owner === 0 ? score : 1 - score) as 0 | 0.5 | 1;
    evidence.rated = match.ranked;
    if (match.rankingResult)
      evidence.opponentRating = match.rankingResult.ratingsBefore[owner === 0 ? 1 : 0];
  }
  return progress;
}
