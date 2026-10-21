import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';
import { createOnlineApp } from '../server/app';
import { OnlineService } from '../server/online-service';
import { createVercelHandler } from '../server/vercel-handler';
import { MemoryOnlineRepository } from '../tests/helpers/online-repository';
import { replayRecord } from '../src/match-record';

// This test injects identity and storage only at the server boundary. Production has no bypass.
const repository = new MemoryOnlineRepository();
const tokens = new Map<string, string>();
const app = await createOnlineApp({
  service: new OnlineService(repository),
  origin: 'http://127.0.0.1:4176',
  authenticate: async (token) => tokens.get(token) ?? null,
});
const handler = createVercelHandler(async () => app);
const apiServer = createHttpServer((request, response) => void handler(request, response));
await new Promise<void>((resolve, reject) => {
  apiServer.once('error', reject);
  apiServer.listen(3002, '127.0.0.1', resolve);
});
const server = await createServer({
  logLevel: 'silent',
  cacheDir: 'node_modules/.vite-online-smoke',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:3002'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_test'),
  },
  server: {
    host: '127.0.0.1',
    port: 4176,
    strictPort: true,
    hmr: false,
    proxy: { '/api': 'http://127.0.0.1:3002' },
  },
});
await server.listen();
const executablePath =
  process.env.PLAYWRIGHT_BROWSER_PATH ??
  [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].find(existsSync);
assert(executablePath, 'No browser found.');
const browser = await chromium.launch({ executablePath, headless: true });
const errors: string[] = [];
const screenshotDir = process.env.ONLINE_SCREENSHOT_DIR;
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });

async function inspect(page: Page, name: string) {
  const axe = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(
    axe.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })),
    [],
    name,
  );
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `${name}: page overflow`,
  );
  if (screenshotDir) await page.screenshot({ path: join(screenshotDir, `${name}.png`) });
}

async function menu(page: Page) {
  await page.goto('http://127.0.0.1:4176', { waitUntil: 'networkidle' });
  await page.locator('[data-home-action="new"]').click();
  await page.locator('[data-home-mode="online"]').click();
  await page.getByRole('heading', { name: 'Batalla en línea', exact: true }).waitFor();
}

try {
  let identity = 0;
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ] as const) {
    const contexts = await Promise.all(
      [0, 1].map(async () => {
        const context = await browser.newContext({
          viewport,
          reducedMotion: name === 'mobile' ? 'reduce' : 'no-preference',
          isMobile: name === 'mobile',
          hasTouch: name === 'mobile',
        });
        const id = `00000000-0000-4000-8000-${String(++identity).padStart(12, '0')}`;
        const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const token = `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
        tokens.set(token, id);
        await context.route('http://127.0.0.1:3002/auth/v1/**', async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': '*',
              'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
            },
            body: JSON.stringify({
              access_token: token,
              token_type: 'bearer',
              expires_in: 3600,
              refresh_token: `refresh-${id}`,
              user: {
                id,
                aud: 'authenticated',
                role: 'authenticated',
                app_metadata: {},
                user_metadata: {},
                is_anonymous: true,
                created_at: new Date().toISOString(),
              },
            }),
          });
        });
        return context;
      }),
    );
    try {
      const [first, second] = await Promise.all(contexts.map((context) => context.newPage()));
      for (const page of [first, second])
        page.on('pageerror', (error) => errors.push(error.message));
      await menu(first);
      const modeCards = first.locator('[data-online-mode]');
      assert.equal(await modeCards.count(), 2);
      for (const card of await modeCards.all()) {
        const positions = await card.evaluate((element) => {
          const icon = element.querySelector('svg')!.getBoundingClientRect();
          const title = element.querySelector('strong')!.getBoundingClientRect();
          return {
            iconBottom: icon.bottom,
            titleTop: title.top,
            iconCenter: icon.x + icon.width / 2,
            titleCenter: title.x + title.width / 2,
          };
        });
        assert(
          positions.iconBottom < positions.titleTop,
          'Each mode icon must sit above its title.',
        );
        assert(
          Math.abs(positions.iconCenter - positions.titleCenter) < 1,
          'Mode icons and titles must share a center line.',
        );
      }
      await inspect(first, `${name}-online-menu`);
      const publicMode = first.getByRole('button', { name: /^Buscar partida/ });
      await publicMode.focus();
      const searchRequest = first.waitForRequest(
        (request) =>
          request.url().endsWith('/api/online') && request.postDataJSON()?.kind === 'search',
      );
      await publicMode.press('Enter');
      const payload = (await searchRequest).postDataJSON();
      assert.deepEqual(Object.keys(payload).sort(), ['kind', 'name']);
      await first.getByRole('heading', { name: 'Esperando rival…' }).waitFor();
      assert.equal(await first.getByRole('checkbox').count(), 0);
      assert.equal(await first.getByRole('combobox').count(), 0);
      assert.equal(
        await first.getByRole('button', { name: 'Crear partida', exact: true }).count(),
        0,
      );
      let releasePoll!: () => void;
      let signalPoll!: () => void;
      const pollGate = new Promise<void>((resolve) => {
        releasePoll = resolve;
      });
      const pollStarted = new Promise<void>((resolve) => {
        signalPoll = resolve;
      });
      let heldPoll = false;
      await first.route('**/api/online', async (route) => {
        if (!heldPoll && route.request().postDataJSON()?.kind === 'state') {
          heldPoll = true;
          signalPoll();
          await pollGate;
        }
        await route.continue();
      });
      try {
        await pollStarted;
        const cancel = first.getByRole('button', { name: 'Cancelar búsqueda' });
        assert(await cancel.isEnabled(), 'Cancel must remain enabled while polling.');
        const waiting = first.locator('.online-waiting');
        assert(
          !/Elo|200|400/.test(await waiting.innerText()),
          'Waiting must not expose matchmaking details.',
        );
        const logo = waiting.locator('.online-search-indicator');
        await logo.evaluate((element: HTMLImageElement) => element.decode());
        const layout = await logo.evaluate((element) => {
          const image = element.getBoundingClientRect();
          const status = element.closest('[role="status"]')!.getBoundingClientRect();
          return {
            offset: Math.abs(image.x + image.width / 2 - status.x - status.width / 2),
            animation: getComputedStyle(element).animationName,
          };
        });
        assert(layout.offset < 1, 'The search logo must be horizontally centered.');
        assert.equal(layout.animation, name === 'mobile' ? 'none' : 'online-search-spin');
        await inspect(first, `${name}-search-waiting`);
        await cancel.click();
        assert(
          await cancel.isEnabled(),
          'Cancel must remain enabled after requesting cancellation.',
        );
      } finally {
        releasePoll();
      }
      await first.getByRole('heading', { name: 'Batalla en línea', exact: true }).waitFor();
      await first.unroute('**/api/online');
      await first.getByRole('button', { name: /^Partida privada/ }).click();
      await first.getByRole('button', { name: 'Unirse a partida privada', exact: true }).click();
      await first.getByText('Introduce un código de seis cifras.', { exact: true }).waitFor();
      await inspect(first, `${name}-private-configuration`);
      await first.getByRole('button', { name: 'Crear partida privada', exact: true }).click();
      await first.getByRole('heading', { name: 'Esperando rival…' }).waitFor();
      await inspect(first, `${name}-private-code`);
      const code = (await first.locator('.online-waiting strong').textContent())!.trim();
      assert.match(code, /^[0-9]{6}$/);
      await contexts[0].grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: 'http://127.0.0.1:4176',
      });
      const copyCode = first.getByRole('button', { name: /^Copiar código/ });
      await copyCode.click();
      await first.getByText('¡Código copiado!', { exact: true }).waitFor();
      assert.equal(await first.evaluate(() => navigator.clipboard.readText()), code);
      assert.equal(
        await first
          .locator('.online-code-content')
          .evaluate((element) => getComputedStyle(element).animationName),
        name === 'mobile' ? 'none' : 'private-code-confirm',
      );
      await inspect(first, `${name}-private-code-copied`);
      await first.getByText('Pulsa para copiar', { exact: true }).waitFor();
      // A refused clipboard write must never show a successful confirmation.
      await first.evaluate(() => {
        Object.defineProperty(navigator.clipboard, 'writeText', {
          configurable: true,
          value: Promise.reject.bind(Promise, new DOMException('Denied', 'NotAllowedError')),
        });
      });
      await copyCode.click();
      await first
        .getByText('No se pudo copiar. Selecciona y copia el código.', { exact: true })
        .waitFor();
      assert.equal(await first.getByText('¡Código copiado!', { exact: true }).count(), 0);
      await first.evaluate(() => {
        Reflect.deleteProperty(navigator.clipboard, 'writeText');
      });
      await copyCode.focus();
      await copyCode.press('Enter');
      await first.getByText('¡Código copiado!', { exact: true }).waitFor();
      assert.equal(await first.evaluate(() => navigator.clipboard.readText()), code);
      // Repeated copies should replay confirmation without replacing the focused button.
      await copyCode.press('Space');
      await first.getByText('¡Código copiado!', { exact: true }).waitFor();
      assert(await copyCode.evaluate((element) => element === document.activeElement));
      await menu(second);
      await second.getByRole('button', { name: /^Partida privada/ }).click();
      await second.getByRole('textbox', { name: 'Código de la partida' }).fill(code);
      await second.getByRole('button', { name: 'Unirse a partida privada', exact: true }).click();
      await Promise.all(
        [first, second].map((page) => page.locator('#home-screen').waitFor({ state: 'hidden' })),
      );
      assert.equal(repository.matches.size, identity / 2);
      for (const page of [first, second]) assert(await page.locator('#blockade-button').isHidden());
      const match = [...repository.matches.values()].at(-1)!;
      const active = replayRecord(match.record).activePlayer;
      const actor = active === 0 ? first : second;
      const observer = active === 0 ? second : first;
      const canvas = actor.locator('#game-canvas');
      await canvas.focus();
      for (let attempt = 0; attempt < 30; attempt++) {
        await canvas.press('u');
        if (await actor.locator('[data-command="rotate"]').isVisible()) break;
      }
      await actor.locator('[data-command="rotate"]').click();
      await actor.locator('[data-direction-order]:enabled').first().click();
      const synced = observer.waitForResponse(async (response) => {
        if (!response.url().endsWith('/api/online') || response.status() !== 200) return false;
        const value = await response.json();
        return value.status === 'playing' && value.record.currentAction === 1;
      });
      await actor.getByRole('button', { name: 'Confirmar acción', exact: true }).click();
      await synced;
      assert.equal(repository.matches.get(match.id)?.record.currentAction, 1);
      await first.locator('#resign-button').click();
      await first.locator('[data-confirm-resign]').click();
      await Promise.all(
        [first, second].map((page) =>
          page.locator('[data-new-game]').waitFor({ state: 'visible' }),
        ),
      );
      await first.locator('[data-new-game]').click();
      await first.locator('[data-home-action="new"]').waitFor();
      console.log(
        `${name}: direct public search, queued cancellation, centered search logo, reduced motion, private code copying (click, keyboard, repeat and denied clipboard), two clients, resignation and Axe passed.`,
      );
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await server.close();
  apiServer.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    apiServer.close((error) => (error ? reject(error) : resolve())),
  );
  await app.close();
}
