import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'vite';

const executablePath =
  process.env.PLAYWRIGHT_BROWSER_PATH ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium',
  ].find(existsSync);
assert(executablePath, 'Se necesita Edge o Chrome.');
const server = await createServer({
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false },
});
await server.listen();
const browser = await chromium.launch({ executablePath, headless: true });
try {
  for (const [mode, viewport, reducedMotion] of [
    ['machine', { width: 1440, height: 900 }, 'no-preference'],
    ['machine', { width: 390, height: 844 }, 'reduce'],
    ['local', { width: 390, height: 844 }, 'no-preference'],
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const { createPlayerProgression } = await import('/src/progression.ts');
      const progress = createPlayerProgression();
      progress.xp = 120;
      localStorage.setItem('hexagonal:progression:v1', JSON.stringify(progress));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-home-action="new"]').click();
    await page.locator(`[data-home-mode="${mode}"]`).click();
    await page.locator('[data-start-free]').click();
    await page.locator('#game-dialog').waitFor({ state: 'hidden' });
    await page.locator('#game-canvas[data-renderer-status="ready"]').waitFor();
    await page.locator('#resign-button').click();
    await page.locator('[data-confirm-resign]').click();
    await page.locator('.battle-progression').waitFor();
    const dialog = page.locator('#game-dialog');
    assert.equal(await dialog.locator('.battle-record-stats > span').count(), 4);
    assert.equal(await dialog.locator('.key-moments').count(), 0);
    assert.equal(await dialog.locator('.battle-rating').count(), mode === 'machine' ? 1 : 0);
    assert(await dialog.getByText(/logro[s]? desbloqueado[s]?/).count());
    if (reducedMotion === 'no-preference') {
      await page.waitForFunction(
        () =>
          Number(document.querySelector('.battle-xp-track')?.getAttribute('aria-valuenow')) === 125,
      );
    }
    await page.locator('.battle-progression[data-xp-animation="complete"]').waitFor();
    const expected = await page.evaluate(async () => {
      const { levelProgress } = await import('/src/progression.ts');
      return levelProgress(JSON.parse(localStorage.getItem('hexagonal:progression:v1')).xp);
    });
    assert(
      (await dialog.locator('[data-battle-level]').innerText()).includes(`Nivel ${expected.level}`),
    );
    assert.equal(
      Number(await dialog.locator('.battle-xp-track').getAttribute('aria-valuenow')),
      expected.current,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    const a11y = await new AxeBuilder({ page }).include('#game-dialog').analyze();
    assert.deepEqual(
      a11y.violations.map((violation) => violation.id),
      [],
    );
    const shot = join(tmpdir(), `hexagonal-outcome-${mode}-${viewport.width}.png`);
    await dialog.screenshot({ path: shot });
    console.log(
      `Resumen validado: ${mode}, ${viewport.width}px, movimiento ${reducedMotion}. Captura: ${shot}`,
    );
    await dialog.locator('[data-analyze]').click();
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('[data-replay-close]').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
