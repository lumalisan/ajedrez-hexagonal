import { parseAchievementProgress } from '../src/achievements.js';
import type { PlayerData } from '../src/cloud-contracts.js';
import type { MatchHistoryEntry, PendingMatch } from '../src/match-storage.js';
import { mergePlayerProgression, parsePlayerProgression } from '../src/progression.js';

export function mergeCloudProgress(cloud: PlayerData, device: PlayerData, at: string): PlayerData {
  const data = { ...cloud };
  const progressKey = 'hexagonal:progression:v1';
  const saved = parsePlayerProgression(cloud[progressKey] ?? '{}');
  const local = parsePlayerProgression(device[progressKey] ?? '{}');
  const progress = mergePlayerProgression(saved, local, at);
  if (cloud[progressKey] || device[progressKey]) data[progressKey] = JSON.stringify(progress);

  const achievementsKey = 'atlas-achievements-v1';
  if (device[achievementsKey]) {
    const savedAchievements = parseAchievementProgress(cloud[achievementsKey] ?? '{}');
    const localAchievements = parseAchievementProgress(device[achievementsKey]);
    const union = (saved: string[], local: string[]) => [...new Set([...saved, ...local])];
    savedAchievements.processedMatchIds = union(
      savedAchievements.processedMatchIds,
      localAchievements.processedMatchIds,
    );
    const processed = new Set(savedAchievements.processedMatchIds);
    savedAchievements.registeredMatchIds = union(
      savedAchievements.registeredMatchIds,
      localAchievements.registeredMatchIds,
    ).filter((id) => !processed.has(id));
    const { counters, processedTacticalEvents } = savedAchievements;
    for (const key of Object.keys(counters) as (keyof typeof counters)[])
      counters[key] = Math.max(counters[key], localAchievements.counters[key]);
    savedAchievements.unlockedAt = {
      ...localAchievements.unlockedAt,
      ...savedAchievements.unlockedAt,
    };
    savedAchievements.completedScenarioIds = union(
      savedAchievements.completedScenarioIds,
      localAchievements.completedScenarioIds,
    );
    savedAchievements.goldScenarioIds = union(
      savedAchievements.goldScenarioIds,
      localAchievements.goldScenarioIds,
    );
    for (const [id, events] of Object.entries(localAchievements.processedTacticalEvents))
      processedTacticalEvents[id] = union(processedTacticalEvents[id] ?? [], events);
    for (const id of processed) delete processedTacticalEvents[id];
    data[achievementsKey] = JSON.stringify(savedAchievements);
  }

  const historyKey = 'atlas-match-history-v1';
  if (device[historyKey]) {
    const history = new Map(
      entries<MatchHistoryEntry>(cloud[historyKey]).map((row) => [row.id, row]),
    );
    for (const row of entries<MatchHistoryEntry>(device[historyKey]))
      if (typeof row.id === 'string' && !saved.matches[row.id]?.completedAt && !history.has(row.id))
        history.set(row.id, row);
    data[historyKey] = JSON.stringify(
      [...history.values()]
        .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
        .slice(0, 30),
    );
  }

  const pendingKey = 'atlas-pending-matches-v1';
  if (cloud[pendingKey] || device[pendingKey]) {
    const pending = new Map<string, PendingMatch>();
    for (const row of [
      ...entries<PendingMatch>(cloud[pendingKey]),
      ...entries<PendingMatch>(device[pendingKey]),
    ]) {
      const id = row.record?.createdAt;
      if (typeof id !== 'string' || progress.matches[id]?.completedAt) continue;
      const previous = pending.get(id);
      if (!previous || Date.parse(row.record.updatedAt) > Date.parse(previous.record.updatedAt))
        pending.set(id, row);
    }
    data[pendingKey] = JSON.stringify([...pending.values()]);
  }
  return data;
}

function entries<T>(raw: string | undefined): T[] {
  const data: unknown = JSON.parse(raw ?? '[]');
  return Array.isArray(data)
    ? data.filter((row): row is T => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    : [];
}
