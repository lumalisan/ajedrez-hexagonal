/** Shared deterministic API fixture; application code always uses the real server. */
export async function installRankingFixture(page) {
  await page.route('**/api/ranking?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const query = {
      mode: params.get('mode'),
      period: params.get('period'),
      page: Number(params.get('page')),
    };
    const total = 51;
    const entries = Array.from({ length: query.page === 0 ? 50 : 1 }, (_, index) => {
      const position = query.page * 50 + index + 1;
      return {
        position,
        playerId: String(position).padStart(64, '0'),
        profile: { name: `Participante ${position}`, emblem: 'shield', color: 'amber' },
        xp: 1200,
        name: `Participante ${position}`,
        played: 10,
        wins: 6,
        draws: 1,
        losses: 3,
        rating: 1500 - position,
      };
    });
    await route.fulfill({ json: { ...query, entries, total, pageSize: 50 } });
  });
}
