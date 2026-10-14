import { describe, expect, it } from 'vitest';
import { playerStatistics, playerRecords } from '../src/profile-statistics';
import {
  createPlayerProgression,
  PROGRESSION_ACHIEVEMENTS,
  progressionValue,
  recordActivity,
  TIERS,
} from '../src/progression';
import { createClassicConfig } from '../src/game-config';
import { MATCH_INITIAL_LAYOUTS } from '../src/setup';

describe('perfil y nuevas opciones', () => {
  it('agrega únicamente partidas terminadas y separa los resultados por modalidad', () => {
    const progress = createPlayerProgression();
    progress.matches = {
      a: { mode: 'online', difficulty: 0, metrics: {}, completedAt: '2026-10-01', result: 1 },
      b: { mode: 'machine', difficulty: 0, metrics: {}, completedAt: '2026-10-02', result: 0.5 },
      c: { mode: 'local', difficulty: 0, metrics: {}, completedAt: '2026-10-03', result: 0 },
      pending: { mode: 'machine', difficulty: 0, metrics: {} },
    };
    expect(playerStatistics(progress)).toEqual({
      played: 3,
      wins: 1,
      draws: 1,
      losses: 1,
      winPercentage: 100 / 3,
    });
    expect(playerStatistics(progress, 'machine')).toMatchObject({
      played: 1,
      draws: 1,
      winPercentage: 0,
    });
    expect(playerStatistics(createPlayerProgression()).winPercentage).toBe(0);
  });
  it('conserva el pico Elo y corta la racha al empatar o perder, ordenando por fecha', () => {
    const progress = createPlayerProgression();
    for (const [index, result, rating] of [
      [4, 1, 1050],
      [0, 1, 1040],
      [2, 0.5, 1080],
      [1, 1, 1100],
      [3, 0, 1040],
    ] as const) {
      progress.matches[String(index)] = {
        mode: 'machine',
        difficulty: 1,
        metrics: {},
        completedAt: '2026-10-0' + (index + 1),
        result,
        battle: { ratingAfter: rating, ratingBefore: 1000, xpBefore: 0, xpAfter: 0, rewards: [] },
      };
    }
    expect(playerRecords(progress, 'machine')).toEqual({
      bestRating: 1100,
      bestStreak: 2,
      monthlyPosition: null,
      historicalPosition: null,
    });
  });
  it('mantiene legibles las partidas heredadas sin asignarles resultados', () => {
    const progress = createPlayerProgression();
    progress.matches.legacy = {
      mode: 'local',
      difficulty: 0,
      metrics: {},
      completedAt: '2026-10-01',
    };
    expect(playerStatistics(progress)).toMatchObject({ played: 1, wins: 0, draws: 0, losses: 0 });
  });
  it('ofrece las dos formaciones y conserva nombres y bandos opuestos en la configuración', () => {
    expect(MATCH_INITIAL_LAYOUTS.map(({ id, name }) => [id, name])).toEqual([
      [3, 'Frente clásico'],
      [5, 'Frente extendido'],
    ]);
    const config = createClassicConfig({
      mode: 'local',
      faction: 'conservationist',
      playerNames: ['Ana', 'Invitado'],
    });
    expect(config.participants).toEqual([
      { kind: 'human', name: 'Ana', faction: 'conservationist' },
      { kind: 'human', name: 'Invitado', faction: 'expansionist' },
    ]);
    expect(createClassicConfig({ mode: 'machine' }).participants[1].name).toBe('Hexfortia');
  });
  it.each([
    ['p1-16', 'meleeKills', 10],
    ['p1-17', 'rangedKills', 10],
    ['p1-18', 'unitKills', 3],
  ] as const)('exige el nuevo umbral de %s', (id, metric, target) => {
    const definition = PROGRESSION_ACHIEVEMENTS.find((entry) => entry.id === id)!;
    const progress = createPlayerProgression();
    const at = '2026-10-14T12:00:00Z';
    expect(definition.target).toBe(target);
    progress.matches.a = { mode: 'local', difficulty: 0, metrics: { [metric]: target - 1 } };
    expect(recordActivity(progress, at).progress.unlockedAt[id]).toBeUndefined();
    progress.matches.b = { mode: 'machine', difficulty: 0, metrics: { [metric]: 1 } };
    if (metric === 'unitKills') {
      expect(progressionValue(progress, definition)).toBe(target - 1);
      progress.matches.b.metrics[metric] = target;
    }
    expect(recordActivity(progress, at).progress.unlockedAt[id]).toBe(at);
    expect(TIERS.slice(0, 3).map(({ xp }) => xp)).toEqual([25, 75, 200]);
  });
});
