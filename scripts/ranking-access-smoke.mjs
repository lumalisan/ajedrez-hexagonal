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
  cacheDir: 'node_modules/.vite-ranking-access',
  server: { host: '127.0.0.1', port: 4176, strictPort: true, hmr: false },
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
      await page.goto(`http://127.0.0.1:4176/${registered ? '?registered' : ''}`, {
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
      assert.deepEqual(errors, []);
      console.log(`Ranking access passed: ${label}, ${registered ? 'registered' : 'guest'}.`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
