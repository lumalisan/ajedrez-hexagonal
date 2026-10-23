import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { chooseSelectOption } from './select-helpers.mjs';

const executablePath =
  process.env.PLAYWRIGHT_BROWSER_PATH ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find(existsSync);
assert(executablePath, 'Set PLAYWRIGHT_BROWSER_PATH to Chrome or Edge.');

const server = await createServer({
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 4178, strictPort: true, hmr: false },
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      reducedMotion: 'reduce',
      timezoneId: 'Europe/Madrid',
    });
    const errors = [];
    try {
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      const modal = page.locator('#game-dialog');
      const capture = async (name) => {
        const path = join(tmpdir(), `hexfortia-ux-${viewport.width}-${name}.png`);
        await page.screenshot({ path });
        console.log(`Screenshot: ${path}`);
      };
      const close = async () => {
        await page.keyboard.press('Escape');
        await modal.waitFor({ state: 'hidden' });
      };
      const noOverflow = async () => {
        assert(
          await modal.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
          'Dialog must not overflow horizontally.',
        );
      };

      await page.goto('http://127.0.0.1:4178', { waitUntil: 'networkidle' });
      await page.locator('[data-home-action="history"]').click();
      await page.getByRole('button', { name: 'Nueva partida', exact: true }).click();
      await page.locator('[data-home-mode="machine"]').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      assert(
        await page
          .locator('[data-home-action="new"]')
          .evaluate((e) => e === document.activeElement),
      );

      await page.locator('[data-home-action="new"]').click();
      await page.locator('[data-home-mode="machine"]').click();
      await chooseSelectOption(page, 'Nivel', 'Fácil');
      assert.match(await page.locator('#ai-difficulty-help').textContent(), /primera partida/);
      await chooseSelectOption(page, 'Nivel', 'Experto');
      assert.match(await page.locator('#ai-difficulty-help').textContent(), /15 segundos/);
      await chooseSelectOption(page, 'Puntos de vida de la Fortaleza', '3');
      assert.match(await page.locator('#fortress-hp-help').textContent(), /3 impactos/);
      await page.locator('[data-layout-preview][data-renderer-status="ready"]').waitFor();
      await modal.locator('h2').scrollIntoViewIfNeeded();
      await noOverflow();
      await capture('config');
      await close();
      await page.keyboard.press('Escape');

      await page.locator('#home-settings-button').click();
      const contrast = page.locator('[data-pref="contrast"]');
      assert.equal(await contrast.getAttribute('aria-checked'), 'false');
      await contrast.click();
      await page.locator('[data-cancel-preferences]').click();
      await page.locator('#home-settings-button').click();
      assert.equal(
        await contrast.getAttribute('aria-checked'),
        'false',
        'Cancel must discard the draft.',
      );
      await chooseSelectOption(page, 'Confirmación de órdenes', 'Rápida');
      assert.match(await page.locator('#confirmation-help').textContent(), /sin confirmación/);
      await page.locator('[data-save-preferences]').click();
      await page.locator('#home-settings-button').click();
      assert.match(await page.locator('#confirmation-help').textContent(), /sin confirmación/);
      assert(
        await page
          .locator('[data-volume="masterVolume"]')
          .evaluate((e) => e.getBoundingClientRect().height >= 44),
        'Volume sliders need a touch target at least 44px high.',
      );
      assert(
        await page
          .locator('.volume-control small')
          .first()
          .evaluate((e) => parseFloat(getComputedStyle(e).fontSize) >= 13),
        'Settings help must be readable without zoom.',
      );
      await capture('settings');
      await page.getByText('Cómo controlar el tablero', { exact: true }).click();
      await page.locator('.board-shortcuts').scrollIntoViewIfNeeded();
      await noOverflow();
      await capture('shortcuts');
      await close();
      await page.locator('#home-settings-button').click();
      assert.equal(
        await modal.evaluate((e) => e.scrollTop),
        0,
        'Reopened dialogs start at their title.',
      );
      assert(await modal.locator('h2').evaluate((e) => e === document.activeElement));
      await close();

      await page.locator('[data-home-action="rules"]').click();
      const nextSection = page
        .getByRole('navigation', { name: 'Continuar leyendo las reglas' })
        .getByRole('button')
        .last();
      await nextSection.click();
      assert(
        await page
          .locator('#rules-article h3')
          .first()
          .evaluate((e) => e === document.activeElement),
      );
      assert.equal(await page.locator('#rules-article').evaluate((e) => e.scrollTop), 0);
      await noOverflow();
      await capture('rules');
      await close();

      await page.locator('[data-home-action="new"]').click();
      await page.locator('[data-home-mode="local"]').click();
      await chooseSelectOption(page, 'Tiempo total', '20 minutos');
      await page.locator('[data-start-free]').click();
      await page.getByRole('button', { name: 'Comenzar partida', exact: true }).click();
      await page.locator('#game-canvas').waitFor({ state: 'visible' });
      assert.equal(
        (await page.locator('#new-game-button').textContent()).trim(),
        'Guardar y salir',
      );
      await page.locator('#help-button').click();
      await page.locator('.match-clock-notice').waitFor({ state: 'visible' });
      await close();
      await page.locator('#settings-button').click();
      await page.locator('.match-clock-notice').waitFor({ state: 'visible' });
      await capture('timed-settings');
      await close();
      await page.locator('#new-game-button').click();
      await page.locator('[data-confirm-abandon]').click();
      await page.locator('[data-home-action="continue"]').waitFor({ state: 'visible' });
      assert.match(
        await page.locator('#home-continue-detail').textContent(),
        /1 partida pendiente/,
      );
      await page.locator('[data-home-action="continue"]').click();
      await page.locator('time[datetime]').waitFor({ state: 'visible' });
      await noOverflow();
      await capture('continue');
      await page.locator('[data-continue-match]').click();
      await page.locator('#resign-button').click();
      await page.locator('[data-confirm-resign]').click();
      await page.getByRole('heading', { name: /vence · rendición rival/ }).waitFor();
      await close();
      assert.equal(
        (await page.locator('#new-game-button').textContent()).trim(),
        'Volver al inicio',
      );
      await page.locator('#new-game-button').click();
      await page.locator('[data-home-action="history"]').click();
      await page.locator('time[datetime]').waitFor({ state: 'visible' });
      await capture('history');
      assert.deepEqual(errors, [], 'No browser runtime errors.');
      console.log(`UX passed at ${viewport.width}×${viewport.height}.`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
