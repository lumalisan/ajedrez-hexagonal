import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';
import { createOnlineApp, type AuthIdentity } from '../server/app';
import { OnlineService } from '../server/online-service';
import { AccountService } from '../server/account-service';
import { createVercelHandler } from '../server/vercel-handler';
import { MemoryOnlineRepository } from '../tests/helpers/online-repository';
import { replayRecord } from '../src/match-record';

// This test injects identity and storage only at the server boundary. Production has no bypass.
const repository = new MemoryOnlineRepository();
const tokens = new Map<string, AuthIdentity>();
const app = await createOnlineApp({
  service: new OnlineService(repository),
  accounts: new AccountService(repository),
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

async function signIn(page: Page) {
  await page.getByLabel('Correo electrónico', { exact: true }).fill('jugador@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.locator('[data-home-action="new"]').waitFor();
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
        tokens.set(token, { id, isAnonymous: true });
        await context.route('http://127.0.0.1:3002/rest/v1/rpc/**', async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': '*',
              'Access-Control-Allow-Methods': 'POST,OPTIONS',
            },
            body:
              route.request().method() === 'POST' &&
              route.request().postDataJSON()?.requested_name === 'Ocupado'
                ? 'false'
                : 'true',
          });
        });
        await context.route('http://127.0.0.1:3002/auth/v1/**', async (route) => {
          const registered = route.request().url().includes('grant_type=password');
          if (registered) tokens.set(token, { id, isAnonymous: false });
          const emailSignup =
            route.request().url().includes('/signup') &&
            Boolean(route.request().postDataJSON()?.email);
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': '*',
              'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
            },
            body: JSON.stringify(
              emailSignup
                ? {
                    id,
                    email: 'nuevo@example.test',
                    aud: 'authenticated',
                    is_anonymous: false,
                    created_at: new Date().toISOString(),
                  }
                : {
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
                      is_anonymous: !registered,
                      email: registered ? 'jugador@example.test' : undefined,
                      created_at: new Date().toISOString(),
                    },
                  },
            ),
          });
        });
        return context;
      }),
    );
    try {
      const [first, second] = await Promise.all(contexts.map((context) => context.newPage()));
      for (const page of [first, second])
        page.on('pageerror', (error) => errors.push(error.message));
      await first.goto('http://127.0.0.1:4176', { waitUntil: 'networkidle' });
      await first.locator('[data-home-action="new"]').click();
      const entry = first.locator('[data-home-mode="online"]');
      assert(await entry.getByText('Requiere cuenta · Inicia sesión o regístrate').isVisible());
      await inspect(first, `${name}-account-required`);
      await entry.focus();
      await entry.press('Enter');
      await first.getByRole('heading', { name: 'Iniciar sesión', exact: true }).waitFor();
      assert.equal(await first.locator('#game-dialog').getAttribute('open'), null);
      assert(
        await first
          .getByLabel('Correo electrónico', { exact: true })
          .evaluate((element) => element === document.activeElement),
      );
      const accountDialog = first.locator('[data-account-dialog]');
      const bounds = (await accountDialog.boundingBox())!;
      // The dialog itself receives clicks on its border and padding, just like its backdrop.
      await accountDialog.click({ position: { x: 1, y: bounds.height / 2 } });
      assert(
        await accountDialog.isVisible(),
        'Clicking the inner border must not dismiss the modal.',
      );
      await accountDialog.click({ position: { x: 12, y: bounds.height / 2 } });
      assert(
        await accountDialog.isVisible(),
        'Clicking interior whitespace must not dismiss the modal.',
      );
      await first.mouse.move(bounds.x + 12, bounds.y + bounds.height / 2);
      await first.mouse.down();
      await first.mouse.move(bounds.x - 6, bounds.y + bounds.height / 2);
      await first.mouse.up();
      assert(
        await accountDialog.isVisible(),
        'A drag from inside to outside must not dismiss the modal.',
      );
      await first.mouse.click(bounds.x - 6, bounds.y + bounds.height / 2);
      await accountDialog.waitFor({ state: 'hidden' });
      await entry.click();
      await first.getByRole('heading', { name: 'Iniciar sesión', exact: true }).waitFor();
      await first.keyboard.press('Escape');
      await first.locator('[data-account-dialog]').waitFor({ state: 'hidden' });
      assert(await entry.evaluate((element) => element === document.activeElement));
      await entry.click();
      await first.getByRole('heading', { name: 'Iniciar sesión', exact: true }).waitFor();
      assert.equal(repository.tickets.size, 0, 'Guests must not enter the public queue.');
      await inspect(first, `${name}-account-signin`);
      await first.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
      await first.getByLabel('Nombre de usuario', { exact: true }).fill('Nuevo jugador');
      await first.getByLabel('Correo electrónico', { exact: true }).fill('nuevo@example.test');
      await first.getByLabel('Contraseña', { exact: true }).fill('Test-password-42!');
      await first.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
      assert.equal(
        await first.getByLabel('Contraseña', { exact: true }).getAttribute('type'),
        'text',
      );
      await first.getByRole('button', { name: 'Ocultar contraseña', exact: true }).click();
      assert.equal(
        await first.getByLabel('Contraseña', { exact: true }).getAttribute('type'),
        'password',
      );
      await inspect(first, `${name}-account-signup`);
      await first.getByLabel('Nombre de usuario', { exact: true }).fill('Ocupado');
      await first.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
      await first
        .getByRole('alert')
        .filter({ hasText: 'Este nombre de usuario ya está en uso.' })
        .waitFor();
      assert.equal(
        await first.getByLabel('Contraseña', { exact: true }).inputValue(),
        'Test-password-42!',
      );
      await first.getByLabel('Nombre de usuario', { exact: true }).fill('Nuevo jugador');
      const registration = first.waitForRequest(
        (request) =>
          new URL(request.url()).pathname.endsWith('/signup') && request.method() === 'POST',
      );
      await first.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
      assert.equal((await registration).postDataJSON().data.username, 'Nuevo jugador');
      await first
        .getByText('Revisa tu correo para confirmar la cuenta.', { exact: false })
        .waitFor();
      await inspect(first, `${name}-account-confirmation`);
      await first.getByRole('button', { name: 'Volver a iniciar sesión' }).click();
      await first.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();
      await inspect(first, `${name}-account-recovery`);
      await first.getByRole('button', { name: 'Enviar enlace' }).click();
      await first.getByText('Si existe una cuenta con ese correo,', { exact: false }).waitFor();
      await first.getByRole('button', { name: 'Volver a iniciar sesión' }).click();
      await first.route(
        '**/auth/v1/token?grant_type=password',
        async (route) => {
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ code: 'invalid_credentials', msg: 'Invalid login credentials' }),
          });
        },
        { times: 1 },
      );
      await first.getByLabel('Correo electrónico', { exact: true }).fill('jugador@example.test');
      await first.getByLabel('Contraseña', { exact: true }).fill('test-password');
      await first.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
      await first.getByRole('alert').filter({ hasText: 'No se pudo iniciar sesión.' }).waitFor();
      assert(
        await first
          .getByRole('alert')
          .filter({ hasText: 'No se pudo iniciar sesión.' })
          .evaluate((element) => element === document.activeElement),
        'Failed authentication must move focus to its error message.',
      );
      assert.equal(
        await first.getByLabel('Contraseña', { exact: true }).inputValue(),
        'test-password',
      );
      await inspect(first, `${name}-account-signin-error`);
      await signIn(first);
      await first.getByRole('button', { name: 'Editar nombre de usuario', exact: true }).click();
      const oldName = await first.locator('.home-profile strong').innerText();
      await first.getByLabel('Nombre de usuario', { exact: true }).fill('Ocupado');
      await first.getByRole('button', { name: 'Guardar nombre', exact: true }).click();
      await first
        .getByRole('alert')
        .filter({ hasText: 'Este nombre de usuario ya está en uso.' })
        .waitFor();
      assert.equal(await first.locator('.home-profile strong').innerText(), oldName);
      await first.getByLabel('Nombre de usuario', { exact: true }).fill('Nombre reservado');
      await inspect(first, name + '-inline-username');
      await first.getByRole('button', { name: 'Guardar nombre', exact: true }).click();
      await first.locator('#home-username-form').waitFor({ state: 'hidden' });
      assert.equal(await first.locator('.home-profile strong').innerText(), 'Nombre reservado');
      if (process.env.ACCOUNT_ONLY) {
        console.log(name + ': registration, occupied names, inline editing and Axe passed.');
        continue;
      }
      await menu(first);
      assert.equal(await first.locator('.online-account-requirement').count(), 0);
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
      await second.goto('http://127.0.0.1:4176', { waitUntil: 'networkidle' });
      await second.locator('[data-home-action="new"]').click();
      await second.locator('[data-home-mode="online"]').click();
      await second.getByRole('heading', { name: 'Iniciar sesión', exact: true }).waitFor();
      await signIn(second);
      await menu(second);
      await second.getByRole('button', { name: /^Partida privada/ }).click();
      await second.getByRole('textbox', { name: 'Código de la partida' }).fill(code);
      await second.getByRole('button', { name: 'Unirse a partida privada', exact: true }).click();
      await Promise.all(
        [first, second].map((page) => page.locator('#home-screen').waitFor({ state: 'hidden' })),
      );
      assert.equal(repository.matches.size, identity / 2);
      for (const page of [first, second])
        await page
          .getByRole('button', { name: 'Proponer tablas', exact: true })
          .waitFor({ state: 'visible' });
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
      await first.locator('.home-profile').click();
      await first.getByRole('button', { name: 'Personalizar', exact: true }).click();
      await first.getByLabel('Nombre de usuario', { exact: true }).fill('Perfil en la nube');
      const cloudSaved = first.waitForResponse(async (response) => {
        if (!response.url().endsWith('/api/account') || response.status() !== 200) return false;
        const save = await response.json();
        const profile = save.data?.['hexagonal:user-profile:v1'];
        return Boolean(profile && JSON.parse(profile).name === 'Perfil en la nube');
      });
      await first.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
      await cloudSaved;
      await first.locator('.home-profile').click();
      await inspect(first, `${name}-account-cloud-profile`);
      await first.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
      await first.getByRole('button', { name: /Iniciar sesión · Invitado/ }).waitFor();
      assert(!(await first.locator('.home-profile').innerText()).includes('Perfil en la nube'));
      // A fresh device cache must recover the saved profile, not its local guest identity.
      await first.evaluate(() => {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('hexfortia:account:') || key.startsWith('hexfortia:cloud-meta:'))
            localStorage.removeItem(key);
        }
      });
      await first.getByRole('button', { name: /Iniciar sesión · Invitado/ }).click();
      await first.getByLabel('Correo electrónico', { exact: true }).fill('jugador@example.test');
      await first.getByLabel('Contraseña', { exact: true }).fill('test-password');
      await first.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
      await first.locator('.home-profile').filter({ hasText: 'Perfil en la nube' }).waitFor();
      console.log(
        `${name}: guest restrictions, signup, login, recovery, cloud save/restore, logout isolation, public search, private multiplayer and Axe passed.`,
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
