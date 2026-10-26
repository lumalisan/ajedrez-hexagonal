import { createHash } from 'node:crypto';
import { normalizeProfile, type UserProfile } from '../src/user-profile.js';
import { playerStatistics, playerRecords } from '../src/profile-statistics.js';
import type { PublicPlayerProfile } from '../src/ranking-contracts.js';
const publicId = (id: string) =>
  createHash('sha256')
    .update('hexfortia:public-profile:' + id)
    .digest('hex');
function readProfile(raw: string | null, name = 'Jugador'): UserProfile {
  try {
    return normalizeProfile(JSON.parse(raw ?? '{}') ?? {}, {
      name,
      emblem: 'fortress',
      color: 'cyan',
    });
  } catch {
    return { name, emblem: 'fortress', color: 'cyan' };
  }
}
import {
  createPlayerProgression,
  parsePlayerProgression,
  rankingSummary,
  calculateElo,
} from '../src/progression.js';
import { replayRecord } from '../src/match-record.js';
import type { RankingEntry, RankingPage, RankingQuery } from '../src/ranking-contracts.js';
import type { OnlineRepository } from './repository.js';
import { OnlineError } from './online-service.js';

/** Public projection only: never return account documents, email addresses or auth identifiers. */
export class RankingService {
  constructor(
    private readonly repository: OnlineRepository,
    private readonly now = Date.now,
  ) {}

  async ownProfile(accountId: string): Promise<PublicPlayerProfile> {
    return this.profile(publicId(accountId));
  }

  async profile(id: string): Promise<PublicPlayerProfile> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new OnlineError('Perfil no encontrado.', 404);
    const data = await this.repository.rankingData('online');
    const account = data.accounts.find((account) => publicId(account.id) === id);
    if (!account) throw new OnlineError('Perfil no encontrado.', 404);
    const saved = await this.repository.transaction(`account:${account.id}`, (tx) =>
      tx.account(account.id),
    );
    const progress = parsePlayerProgression(
      saved?.data['hexagonal:progression:v1'] ?? account.progression ?? '{}',
    );
    // Online statistics use server results rather than uploaded account evidence.
    for (const [key, match] of Object.entries(progress.matches)) {
      if (match.mode === 'online') delete progress.matches[key];
    }
    progress.ratings.online = data.players.find((player) => player.id === account.id)?.elo ?? 1000;
    for (const match of data.matches) {
      const owner = match.players.indexOf(account.id);
      if (owner < 0) continue;
      const outcome = match.rankingResult ? null : replayRecord(match.record).outcome;
      const score =
        match.rankingResult?.score ??
        (outcome?.type === 'draw'
          ? 0.5
          : outcome?.type === 'win'
            ? Number(outcome.winner === 0)
            : null);
      if (score === null) continue;
      progress.matches['online:' + match.id] = {
        mode: 'online',
        difficulty: 0,
        metrics: {},
        completedAt: match.rankingResult?.completedAt ?? match.record.updatedAt,
        result: (owner === 0 ? score : 1 - score) as 0 | 0.5 | 1,
        opponentRating: match.rankingResult?.ratingsBefore[owner === 0 ? 1 : 0] ?? 1000,
      };
    }
    const positions: Record<'online' | 'machine', number | null> = { online: null, machine: null };
    const records = {
      machine: playerRecords(progress, 'machine'),
      online: playerRecords(progress, 'online'),
    };
    const now = this.now();
    for (const mode of ['online', 'machine'] as const) {
      const source = mode === 'online' ? data : await this.repository.rankingData(mode);
      const times = new Set<number>([now]);
      const addTime = (value: string | undefined) => {
        if (!value) return;
        const time = Date.parse(value);
        if (time <= now) times.add(time);
        // Monthly positions also change when results leave the rolling window.
        const expiry = new Date(value);
        expiry.setDate(expiry.getDate() + 30);
        expiry.setHours(0, 0, 0, 0);
        if (expiry.getTime() <= now) times.add(expiry.getTime());
      };
      if (mode === 'machine') {
        for (const player of source.accounts)
          for (const match of Object.values(
            parsePlayerProgression(player.progression ?? '{}').matches,
          ))
            if (match.mode === mode) addTime(match.completedAt);
      } else {
        for (const match of source.matches)
          addTime(match.rankingResult?.completedAt ?? match.record.updatedAt);
      }
      for (const time of times) {
        for (const period of ['month', 'all'] as const) {
          const result = this.listAt({ mode, period, page: 0 }, source, time, now, account.id);
          const position = result.entries.find((entry) => entry.playerId === id)?.position ?? null;
          if (time === now && period === 'all') positions[mode] = position;
          const key = period === 'month' ? 'monthlyPosition' : 'historicalPosition';
          if (position !== null)
            records[mode][key] = Math.min(records[mode][key] ?? position, position);
        }
      }
    }
    return {
      positions,
      profile: readProfile(
        account.profile,
        data.players.find((player) => player.id === account.id)?.name,
      ),
      progression: {
        xp: progress.xp,
        unlockedAt: progress.unlockedAt,
        activity: { ...progress.activity, lastDay: null },
        ratings: progress.ratings,
      },
      statistics: {
        local: playerStatistics(progress, 'local'),
        machine: playerStatistics(progress, 'machine'),
        online: playerStatistics(progress, 'online'),
        total: playerStatistics(progress),
      },
      records,
    };
  }
  async list(query: RankingQuery): Promise<RankingPage> {
    if (
      !query ||
      !['machine', 'online'].includes(query.mode) ||
      !['all', 'month'].includes(query.period) ||
      !Number.isSafeInteger(query.page) ||
      query.page < 0
    )
      throw new OnlineError('Consulta de clasificación no válida.');
    const now = this.now();
    return this.listAt(query, await this.repository.rankingData(query.mode), now, now);
  }

  private listAt(
    query: RankingQuery,
    data: Awaited<ReturnType<OnlineRepository['rankingData']>>,
    time: number,
    now: number,
    targetId?: string,
  ): RankingPage {
    const historical = time < now;
    const registered = new Set(data.accounts.map((account) => account.id));
    const at = new Date(time).toISOString();
    const names = new Map<string, string>();
    const profiles = new Map(
      data.accounts.map((account) => [account.id, readProfile(account.profile)]),
    );
    const entries: Array<RankingEntry & { id: string }> = [];
    for (const account of data.accounts) {
      let name = 'Jugador';
      try {
        const profile: unknown = JSON.parse(account.profile ?? 'null');
        if (
          profile &&
          typeof profile === 'object' &&
          'name' in profile &&
          typeof profile.name === 'string'
        )
          name = profile.name.trim().slice(0, 40) || name;
      } catch {
        /* Legacy damaged profiles keep their anonymous display name. */
      }
      if (account.profile) names.set(account.id, name);
      if (query.mode === 'machine') {
        const progress = parsePlayerProgression(account.progression ?? '{}');
        if (historical) {
          const matches = Object.entries(progress.matches)
            .filter(
              ([, match]) =>
                match.mode === 'machine' &&
                match.completedAt &&
                Date.parse(match.completedAt) <= time,
            )
            .sort(([, a], [, b]) => a.completedAt!.localeCompare(b.completedAt!));
          progress.matches = Object.fromEntries(matches);
          progress.ratings.machine = 1000;
          let rated = 0;
          for (const [, match] of matches) {
            if (match.rated === false) continue;
            progress.ratings.machine =
              match.battle?.ratingAfter ??
              calculateElo(
                progress.ratings.machine,
                match.opponentRating ?? 1000,
                match.result ?? 0.5,
                rated,
              );
            rated++;
          }
        }
        const summary = rankingSummary(progress, 'machine', query.period, at);
        if (summary.played) entries.push({ id: account.id, name, position: 0, ...summary });
      }
    }
    if (query.mode === 'online') {
      const histories = new Map<string, ReturnType<typeof createPlayerProgression>>();
      const ratings = new Map<string, { elo: number; played: number }>();
      const completedAt = (match: (typeof data.matches)[number]) =>
        match.rankingResult?.completedAt ?? match.record.updatedAt;
      for (const match of [...data.matches]
        .filter((match) => !historical || Date.parse(completedAt(match)) <= time)
        .sort((a, b) => completedAt(a).localeCompare(completedAt(b)) || a.id.localeCompare(b.id))) {
        // Old settled records are reconstructed through the same rules as replays.
        const outcome = match.rankingResult ? null : replayRecord(match.record).outcome;
        const score =
          match.rankingResult?.score ??
          (outcome?.type === 'draw'
            ? 0.5
            : outcome?.type === 'win'
              ? outcome.winner === 0
                ? 1
                : 0
              : null);
        if (score === null) continue;
        const before = match.players.map((id) => ratings.get(id) ?? { elo: 1000, played: 0 });
        const ratingsBefore = match.rankingResult?.ratingsBefore ?? [
          before[0]!.elo,
          before[1]!.elo,
        ];
        for (const [index, id] of match.players.entries()) {
          const result = (index === 0 ? score : 1 - score) as 0 | 0.5 | 1;
          ratings.set(id, {
            elo: calculateElo(
              ratingsBefore[index]!,
              ratingsBefore[index === 0 ? 1 : 0]!,
              result,
              before[index]!.played,
            ),
            played: before[index]!.played + 1,
          });
          const progress = histories.get(id) ?? createPlayerProgression();
          progress.matches[match.id] = {
            mode: 'online',
            difficulty: 0,
            metrics: {},
            rated: true,
            completedAt: match.rankingResult?.completedAt ?? match.record.updatedAt,
            result,
            opponentRating: ratingsBefore[index === 0 ? 1 : 0],
          };
          histories.set(id, progress);
        }
      }
      for (const player of data.players) {
        if (!registered.has(player.id)) continue;
        const progress = histories.get(player.id) ?? createPlayerProgression();
        progress.ratings.online = historical ? (ratings.get(player.id)?.elo ?? 1000) : player.elo;
        const summary = rankingSummary(progress, 'online', query.period, at);
        if ((historical || query.period === 'month') && !summary.played) continue;
        entries.push({
          id: player.id,
          name: names.get(player.id) ?? player.name,
          position: 0,
          ...summary,
        });
      }
    }
    entries.sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.id.localeCompare(b.id));
    const pageSize = 50;
    const start = targetId
      ? entries.findIndex((entry) => entry.id === targetId)
      : query.page * pageSize;
    return {
      ...query,
      pageSize,
      total: entries.length,
      entries: entries
        .slice(Math.max(0, start), targetId ? Math.max(0, start) + 1 : start + pageSize)
        .map((entry, index) => ({
          playerId: publicId(entry.id),
          xp: parsePlayerProgression(
            data.accounts.find((account) => account.id === entry.id)?.progression ?? '{}',
          ).xp,
          profile: { ...profiles.get(entry.id)!, name: entry.name },
          name: entry.name,
          played: entry.played,
          wins: entry.wins,
          draws: entry.draws,
          losses: entry.losses,
          rating: entry.rating,
          position: Math.max(0, start) + index + 1,
        })),
    };
  }
}
