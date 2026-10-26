import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import AxeBuilder from '@axe-core/playwright';
import { installRankingFixture } from './ranking-fixture.mjs';

const executablePath =
  process.env.PLAYWRIGHT_BROWSER_PATH ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium',
  ].find(existsSync);
assert(executablePath, 'No browser found. Set PLAYWRIGHT_BROWSER_PATH.');

// Replace only the external Auth SDK in this test server. The real SPA, account
// controller, session, ranking transport and dialog are exercised together.
const server = await createServer({
  logLevel: 'silent',
  cacheDir: 'node_modules/.vite-profile-options',
  server: { host: '127.0.0.1', port: 4177, strictPort: true, hmr: false },
  plugins: [
    {
      name: 'ranking-auth-fixture',
      enforce: 'pre',
      load(id) {
        if (!id.replaceAll('\\', '/').endsWith('/src/supabase-client.ts')) return;
        return `
        const session = location.search.includes('registered') ? {
          access_token: 'ranking-access-test',
          user: { id: '00000000-0000-0000-0000-000000000001', email: 'ranking@example.test', is_anonymous: false }
        } : null;
        export const browserSupabase = () => Promise.resolve({ auth: {
          getSession: async () => ({ data: { session }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
        } });
      `;
      },
    },
  ],
});
await server.listen();
const browser = await chromium.launch({ executablePath, headless: true });
try {
  for (const [label, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    for (const registered of [false, true]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const requests = [];
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await installRankingFixture(page);
      await page.route('**/api/ranking?playerId=*', (route) =>
        route.fulfill({
          json: {
            profile: { name: 'Participante 1', emblem: 'shield', color: 'amber' },
            progression: {
              xp: 1200,
              unlockedAt: {},
              activity: { lastDay: null, streak: 2, best: 4 },
              ratings: { machine: 1400, online: 1250 },
            },
            statistics: Object.fromEntries(
              ['machine', 'online', 'local', 'total'].map((mode) => [
                mode,
                { played: 10, wins: 6, draws: 1, losses: 3, winPercentage: 60 },
              ]),
            ),
            records: Object.fromEntries(
              ['machine', 'online'].map((mode) => [
                mode,
                {
                  bestRating: 1500,
                  bestStreak: 4,
                  monthlyPosition: null,
                  historicalPosition: null,
                },
              ]),
            ),
          },
        }),
      );
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/ranking') requests.push(request);
      });
      await page.route('**/api/account', (route) =>
        route.fulfill({
          json: {
            revision: 1,
            elo: 1000,
            data: {
              'hexagonal:user-profile:v1': JSON.stringify({
                name: 'Cuenta de prueba',
                emblem: 'hex',
                color: 'cyan',
              }),
            },
          },
        }),
      );
      await page.route('**/api/online', (route) => route.fulfill({ json: { status: 'idle' } }));
      await page.goto(`http://127.0.0.1:4177/${registered ? '?registered' : ''}`, {
        waitUntil: 'networkidle',
      });
      await page.locator('[data-home-action="ranking"]').click();
      await page.locator('.ranking-table tbody tr').first().waitFor();
      const notice = page.getByText(
        'Crea una cuenta o inicia sesión para consultar la clasificación completa.',
        { exact: true },
      );
      if (registered) {
        assert.equal(await page.locator('.ranking-table tbody tr').count(), 50);
        assert.equal(await notice.count(), 0);
        assert.equal(requests[0].headers().authorization, 'Bearer ranking-access-test');
        await page.getByRole('button', { name: 'Participante 1', exact: true }).click();
        await page.locator('.profile-browser').waitFor();
        assert.equal(
          await page.getByRole('button', { name: 'Configuración', exact: true }).count(),
          0,
        );
        assert.match(await page.locator('.achievements-profile').textContent(), /Participante 1/);
        await page.getByRole('tab', { name: 'Estadísticas', exact: true }).click();

        const profileAxe = await new AxeBuilder({ page }).analyze();
        assert.deepEqual(
          profileAxe.violations.filter((v) => ['serious', 'critical'].includes(v.impact)),
          [],
        );
        await page.screenshot({ path: 'node_modules/.cache/profile-' + label + '.png' });
        await page.getByRole('button', { name: 'Volver a clasificación', exact: true }).click();
        await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
        await page.getByRole('rowheader', { name: 'Participante 51', exact: true }).waitFor();
      } else {
        assert.equal(await page.locator('.ranking-table tbody tr').count(), 1);
        await notice.waitFor();
        assert.equal(requests.length, 0);
        assert.equal(
          await page.getByRole('navigation', { name: 'Páginas de clasificación' }).isVisible(),
          false,
        );
      }
      await page.getByRole('button', { name: 'Vs. Hexfortia', exact: true }).click();
      await page.getByRole('tab', { name: 'Histórica', exact: true }).click();
      await page.locator('.ranking-table tbody tr').first().waitFor();
      const result = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(
        result.violations.filter((v) => ['serious', 'critical'].includes(v.impact)),
        [],
      );
      if (process.env.UI_SCREENSHOT)
        await page.screenshot({
          path: `${process.env.UI_SCREENSHOT}-${label}-${registered ? 'registered' : 'guest'}.png`,
        });
      if (!registered) {
        await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
        await page.getByRole('dialog', { name: 'Crear cuenta', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Cerrar acceso a cuenta', exact: true }).click();
        await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
        await page.getByRole('dialog', { name: 'Iniciar sesión', exact: true }).waitFor();
        assert.equal(requests.length, 0);
      }
      if (registered) {
        await page.getByRole('button', { name: 'Cerrar clasificación', exact: true }).click();
        await page.locator('[data-home-action="new"]').click();
        const backgrounds = await page
          .locator('[data-home-mode]')
          .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
        assert.equal(new Set(backgrounds).size, 1);
        await page.locator('[data-home-mode="machine"]').click();
        assert.equal(await page.locator('#ai-difficulty-help, #fortress-hp-help').count(), 0);
        await page.locator('[data-back-menu]').click();
        await page.locator('[data-home-mode="online"]').click();
        await page.getByRole('button', { name: /Crear partida privada/ }).waitFor();
        await page.screenshot({ path: 'node_modules/.cache/options-' + label + '.png' });
        await page.locator('[data-online-mode="private-join"]').click();
        await page.locator('#private-code').fill('12');
        await page.getByRole('button', { name: 'Unirse a partida privada', exact: true }).click();
        await page.getByText('Introduce un código de seis cifras.', { exact: true }).waitFor();
        assert.equal(await page.locator('#fortress-hp').count(), 0);
        await page.getByRole('button', { name: 'Volver', exact: true }).click();
        await page.locator('[data-online-mode="private"]').click();
        await page.getByRole('heading', { name: 'Crear partida privada', exact: true }).waitFor();
        assert.equal(await page.locator('#private-code').count(), 0);
        const optionsAxe = await new AxeBuilder({ page }).analyze();
        assert.deepEqual(
          optionsAxe.violations.filter((v) => ['serious', 'critical'].includes(v.impact)),
          [],
        );
      }
      assert.deepEqual(errors, []);
      console.log(`Ranking access passed: ${label}, ${registered ? 'registered' : 'guest'}.`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
