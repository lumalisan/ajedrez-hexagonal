import { describe, expect, it } from 'vitest';
import { AccountService } from '../server/account-service';
import { RankingService } from '../server/ranking-service';
import { createPlayerProgression } from '../src/progression';
import { MemoryOnlineRepository } from './helpers/online-repository';

describe('progreso del perfil público', () => {
  it('carga el guardado aunque la proyección online no incluya el progreso', async () => {
    const repository = new MemoryOnlineRepository();
    const progression = createPlayerProgression();
    progression.xp = 650;
    progression.ratings.machine = 1370;
    progression.matches['2026-10-25T10:00:00Z'] = {
      mode: 'machine',
      difficulty: 1,
      metrics: {},
      result: 1,
      completedAt: '2026-10-25T10:00:00Z',
    };
    await new AccountService(repository).request('player', {
      kind: 'save',
      revision: 0,
      data: {
        'hexagonal:user-profile:v1': JSON.stringify({ name: 'Ariadna' }),
        'hexagonal:progression:v1': JSON.stringify(progression),
      },
    });
    const rankingData = repository.rankingData.bind(repository);
    const ranking = new RankingService(repository);
    const original = await rankingData();
    const entries = await ranking.list({ mode: 'machine', period: 'all', page: 0 });
    repository.rankingData = async () => ({
      ...original,
      accounts: original.accounts.map((account) => ({ ...account, progression: null })),
    });
    const profile = await ranking.profile(entries.entries[0]!.playerId!);
    expect(profile.profile.name).toBe('Ariadna');
    expect(profile.progression.xp).toBe(650);
    expect(profile.progression.ratings.machine).toBe(1370);
    expect(profile.statistics.machine).toMatchObject({ played: 1, wins: 1 });
  });
});
