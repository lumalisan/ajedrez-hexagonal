import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from 'playwright-core';
import { preview } from 'vite';
import { chooseSelectOption, selectedOptionLabel } from './select-helpers.mjs';

const candidates =
  process.platform === 'win32'
    ? [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      ]
    : [
        '/usr/bin/microsoft-edge',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ];
const executablePath = process.env.PLAYWRIGHT_BROWSER_PATH || candidates.find(existsSync);
assert(executablePath, 'No browser found. Set PLAYWRIGHT_BROWSER_PATH to Chrome or Edge.');

const origin = 'http://127.0.0.1:4177';
const server = await preview({
  logLevel: 'silent',
  preview: { host: '127.0.0.1', port: 4177, strictPort: true },
});
let browser;
const runtimeErrors = [];

try {
  const assetsDirectory = resolve(server.config.root, server.config.build.outDir, 'assets');
  assert(existsSync(assetsDirectory), 'Production assets are missing. Run pnpm build first.');
  const builtAssets = readdirSync(assetsDirectory, { recursive: true })
    .filter((file) => /\.(?:js|css)$/.test(file))
    .map((file) => `/assets/${file.replaceAll('\\', '/')}`);
  const achievementDirectory = resolve(
    server.config.root,
    server.config.build.outDir,
    'achievements',
  );
  assert(
    existsSync(achievementDirectory),
    'Production achievement artwork is missing. Run pnpm build first.',
  );
  const achievementImages = readdirSync(achievementDirectory)
    .filter((file) => file.endsWith('.webp'))
    .map((file) => `/achievements/${file}`);
  assert(achievementImages.length === 28, 'The build must contain all 28 achievement images.');
  assert(
    builtAssets.some((asset) => asset.endsWith('.js')),
    'The build must contain JavaScript.',
  );
  assert(
    builtAssets.some((asset) => asset.endsWith('.css')),
    'The build must contain CSS.',
  );
  const dialogChunks = ['game-dialogs', 'utility-dialogs'].map((name) => {
    const chunk = builtAssets.find((asset) => new RegExp(`/${name}-[^/]+\\.js$`).test(asset));
    assert(chunk, `Missing lazy ${name} chunk. Run pnpm build with the current source.`);
    return chunk;
  });

  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    serviceWorkers: 'allow',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const offlineModules = new Set();
  let offline = false;

  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /failed to (?:fetch dynamically imported module|load module script)|importing a module script failed|unable to preload CSS|MIME type/i.test(
        message.text(),
      )
    )
      runtimeErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    if (['script', 'stylesheet'].includes(request.resourceType()))
      runtimeErrors.push(`${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`);
  });
  page.on('response', (response) => {
    const request = response.request();
    if (!['script', 'stylesheet'].includes(request.resourceType())) return;
    const type = response.headers()['content-type'] ?? '';
    const expectedType = request.resourceType() === 'script' ? /javascript|ecmascript/i : /css/i;
    if (!response.ok() || !expectedType.test(type))
      runtimeErrors.push(
        `${response.status()} ${response.url()} returned ${type || 'no MIME type'}`,
      );
    if (offline && response.fromServiceWorker())
      offlineModules.add(new URL(response.url()).pathname);
  });

  // Only the home screen is visited online: neither lazy dialog has been opened.
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.locator('[data-home-action="new"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, {
    timeout: 30_000,
  });
  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return { active: ready.active?.state, controlled: Boolean(navigator.serviceWorker.controller) };
  });
  assert(
    registration.active === 'activated' && registration.controlled,
    'The installed service worker must be ready and control the home page.',
  );

  const initialResources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname),
  );
  for (const chunk of dialogChunks)
    assert(
      !initialResources.includes(chunk),
      `${chunk} must not load before its dialog is opened.`,
    );

  const cachedAssets = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith('protocolo-hexagonal-'));
    const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return {
      names,
      paths: requests.flat().map((request) => new URL(request.url).pathname),
    };
  });
  assert(cachedAssets.names.length > 0, 'The production service worker must create its cache.');
  assert(
    !existsSync(resolve(server.config.root, server.config.build.outDir, 'rules')) &&
      !cachedAssets.paths.some((path) => path.startsWith('/rules/')),
    'Obsolete static rules illustrations must be absent from the build and offline cache.',
  );
  const missingAssets = builtAssets.filter((asset) => !cachedAssets.paths.includes(asset));
  assert(
    missingAssets.length === 0,
    `All generated JS and CSS, including unopened lazy chunks, must be precached: ${missingAssets.join(', ')}`,
  );
  const missingAchievementImages = achievementImages.filter(
    (asset) => !cachedAssets.paths.includes(asset),
  );
  assert(
    missingAchievementImages.length === 0,
    `All achievement images must be precached before the collection is opened: ${missingAchievementImages.join(', ')}`,
  );

  offline = true;
  await context.setOffline(true);
  const reload = await page.reload({ waitUntil: 'networkidle' });
  assert(
    reload?.fromServiceWorker(),
    'The home page must reload through the service worker offline.',
  );
  await page.locator('[data-home-action="new"]').waitFor({ state: 'visible' });
  assert(await page.evaluate(() => !navigator.onLine), 'The browser must remain offline.');

  await page.locator('[data-home-action="achievements"]').click();
  await page.getByRole('heading', { name: 'Logros', exact: true }).waitFor();
  assert(
    await page.getByText('¡Chúpate esa!', { exact: true }).isVisible(),
    'The achievement collection and its descriptions must be available offline.',
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-achievement-id] .achievement-icon')].every(
      (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
    ),
  );
  const offlineArtwork = await page
    .locator('[data-achievement-id] img.achievement-icon')
    .evaluateAll((images) =>
      images.map((image) => ({
        source: new URL(image.currentSrc).pathname,
        width: image.naturalWidth,
        height: image.naturalHeight,
      })),
    );
  assert(
    offlineArtwork.length === 28 &&
      new Set(offlineArtwork.map(({ source }) => source)).size === 28 &&
      offlineArtwork.every(
        ({ source, width, height }) =>
          achievementImages.includes(source) && width === 512 && width === height,
      ),
    'All 28 achievement images must load at 512×512 on the first collection visit while offline.',
  );
  await page.keyboard.press('Escape');
  await page.locator('#game-dialog').waitFor({ state: 'hidden' });

  await page.locator('[data-home-action="rules"]').click();
  await page.locator('[data-rule-section="desarrollo"]').click();
  const rulesPreview = page.locator('[data-rules-layout-preview]');
  await page.locator('[data-rules-layout-preview][data-renderer-status="ready"]').waitFor();
  assert(
    (await rulesPreview.getAttribute('data-layout')) === '1' &&
      (await rulesPreview.getAttribute('data-piece-count')) === '36',
    'The real default deployment must render on the first rules visit while offline.',
  );
  await chooseSelectOption(page, 'Disposición inicial', 'Frente extendido');
  assert(
    (await rulesPreview.getAttribute('data-layout')) === '5' &&
      (await rulesPreview.getAttribute('data-piece-count')) === '44',
    'The live rules board must show the selected complete deployment offline.',
  );
  await page.locator('.rules-close').click();

  await page.locator('[data-home-action="new"]').click();
  await page.locator('[data-home-mode="local"]').click();
  await page.locator('[data-preset="custom"]').click();
  await chooseSelectOption(page, 'Disposición inicial', 'Frente blindado');
  assert(
    (await selectedOptionLabel(page, 'Disposición inicial')) === 'Frente blindado',
    'The layout selector must accept a new value on its first offline visit.',
  );
  assert(
    (await page.locator('[data-layout-preview]').getAttribute('data-layout')) === '3',
    'The layout preview must update offline.',
  );
  await page.locator('[data-start-free]').click();
  await page.locator('#game-dialog').waitFor({ state: 'hidden' });
  await page.locator('#game-canvas').waitFor({ state: 'visible' });
  await page.locator('#game-canvas[data-renderer-status="ready"]').waitFor();
  assert(
    (await page.locator('#game-canvas').getAttribute('data-renderer'))?.startsWith('pixi-'),
    'Pixi and its renderer modules must initialize offline.',
  );
  assert(
    !(await page.locator('#app').evaluate((element) => element.classList.contains('home-active'))),
    'Starting the offline game must leave the home screen.',
  );

  await page.locator('#settings-button').click();
  await chooseSelectOption(page, 'Confirmación de órdenes', 'Solo críticas');
  assert(
    (await selectedOptionLabel(page, 'Confirmación de órdenes')) === 'Solo críticas',
    'The confirmation selector must work on the first offline settings visit.',
  );
  const savedConfirmation = await page.evaluate(
    () => JSON.parse(localStorage.getItem('atlas-preferences-v2') ?? '{}').confirmation,
  );
  assert(savedConfirmation === 'critical', 'The offline settings change must persist locally.');
  for (const chunk of dialogChunks)
    assert(
      offlineModules.has(chunk),
      `${chunk} must be fetched from the service worker when first opened offline.`,
    );

  // A missing asset must fail; serving the navigation fallback would hide a broken precache.
  const missingModule = await page.evaluate(async () => {
    try {
      const response = await fetch('/assets/__offline-missing-module__.js');
      return {
        failed: false,
        ok: response.ok,
        contentType: response.headers.get('content-type') ?? '',
      };
    } catch {
      return { failed: true, ok: false, contentType: '' };
    }
  });
  assert(
    missingModule.failed || (!missingModule.ok && !/html/i.test(missingModule.contentType)),
    'An unknown JavaScript asset must fail offline instead of receiving the HTML shell.',
  );
  assert(runtimeErrors.length === 0, `Offline runtime errors:\n${runtimeErrors.join('\n')}`);
  console.log(
    `Offline smoke passed: ${builtAssets.length} generated JS/CSS assets and 28 achievement images precached, collection artwork, live rules layouts and both lazy dialogs opened for the first time offline.`,
  );
} catch (error) {
  if (runtimeErrors.length > 0)
    console.error(`Offline runtime errors:\n${runtimeErrors.join('\n')}`);
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    await new Promise((complete, reject) => {
      server.httpServer.close((error) => (error ? reject(error) : complete()));
    });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
