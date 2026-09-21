import { existsSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { chooseSelectOption, openSelect } from './select-helpers.mjs';

const candidates =
  process.platform === 'win32'
    ? [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      ]
    : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const executablePath = process.env.PLAYWRIGHT_BROWSER_PATH || candidates.find(existsSync);
if (!executablePath) throw new Error('No browser found. Set PLAYWRIGHT_BROWSER_PATH.');

const server = await createServer({
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 4175, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const scans = [];
  const profiles = [
    { name: 'Desktop 1440×900', viewport: { width: 1440, height: 900 }, isMobile: false },
    { name: 'Mobile 390×844', viewport: { width: 390, height: 844 }, isMobile: true },
  ];

  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport: profile.viewport,
      isMobile: profile.isMobile,
      hasTouch: profile.isMobile,
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      const audit = async (surface) => {
        const label = `${profile.name} / ${surface}`;
        const results = await new AxeBuilder({ page }).analyze();
        scans.push({ label, results });
        console.log(`Axe scanned: ${label}, ${results.passes.length} passed rule checks.`);
      };

      await page.goto('http://127.0.0.1:4175', { waitUntil: 'networkidle' });
      await audit('home');

      await page.locator('[data-home-action="rules"]').click();
      await page.locator('#rules-article').waitFor({ state: 'visible' });
      await audit('rules manual');
      await page.locator('.rules-close').click();

      await page.locator('[data-home-action="new"]').click();
      await page.locator('[data-home-mode="machine"]').click();
      await page
        .getByRole('combobox', { name: 'Dificultad', exact: true })
        .waitFor({ state: 'visible' });
      await audit('AI configuration / difficulty');
      await openSelect(page, 'Dificultad');
      await audit('AI configuration / open difficulty menu');
      await chooseSelectOption(page, 'Dificultad', 'Experto');
      await audit('AI configuration / expert');
      await page.locator('[data-back-menu]').click();
      await page.locator('[data-home-mode="local"]').click();
      await page.locator('[data-start-free]').waitFor({ state: 'visible' });
      await audit('match configuration');
      await page.locator('[data-preset="custom"]').click();
      const fortressControl = await openSelect(page, 'Puntos de vida de la Fortaleza');
      await audit('custom match / open fortress health menu');
      await fortressControl.press('Escape');
      await openSelect(page, 'Disposición inicial');
      await audit('custom match / open layout menu');
      await chooseSelectOption(
        page,
        'Disposición inicial',
        profile.isMobile ? 'Frente de infantería' : 'Frente blindado',
      );
      await page.locator('[data-layout-preview]').waitFor({ state: 'visible' });
      await audit('custom match / initial layout preview');
      await chooseSelectOption(page, 'Disposición inicial', 'Frente extendido');
      await audit('custom match / extended layout preview');
      const clockControl = await openSelect(page, 'Tiempo');
      await audit('match configuration / open time control menu');
      await clockControl.press('Escape');
      await page.locator('[data-preset="tactical"]').click();
      await page.locator('[data-start-free]').click();
      await page.locator('#game-canvas').waitFor({ state: 'visible' });

      await page.locator('#command-panel').waitFor({ state: 'hidden' });
      await audit('match / no selection');
      await page.locator('#game-canvas').focus();
      await page.keyboard.press('s');
      await page.keyboard.press('s');
      await page.keyboard.press('Enter');
      await page.locator('#command-panel').waitFor({ state: 'visible' });
      await audit('match / selected unit');
      if (!profile.isMobile) {
        await page.locator('#command-window-titlebar').focus();
        await page.keyboard.press('ArrowLeft');
        await page.locator('#minimize-command-panel').click();
        await page.locator('#command-panel-restore').waitFor({ state: 'visible' });
        await audit('match / command window minimized');
        await page.locator('#command-panel-restore').click();
        await page.locator('#command-panel').waitFor({ state: 'visible' });
        await page.locator('#game-canvas').focus();
      }
      await page.keyboard.press('w');
      await page.keyboard.press('Enter');
      await page.locator('#pending-card').waitFor({ state: 'visible' });
      await audit('match / pending order');
      await page.locator('#cancel-selection').click();
      await page.locator('#log-toggle').click();
      await page.locator('#battle-log-panel').waitFor({ state: 'visible' });
      await audit('match / battle log');
      await page.locator('#close-battle-log').click();

      await page.locator('#settings-button').click();
      await page.locator('.accessibility-settings').waitFor({ state: 'visible' });
      await audit('settings');
      const confirmationControl = await openSelect(page, 'Confirmación de órdenes');
      await audit('settings / open order confirmation menu');
      await confirmationControl.press('Escape');
      await page.locator('[data-dialog-close]').click();
      await page.locator('#new-game-button').click();
      await page.locator('[data-confirm-abandon]').waitFor({ state: 'visible' });
      await audit('abandon confirmation');
    } finally {
      await context.close();
    }
  }

  const serious = scans.flatMap(({ label, results }) =>
    results.violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map((violation) => ({ label, violation })),
  );
  if (serious.length) {
    const summary = serious
      .map(
        ({ label, violation }) =>
          `[${label}] ${violation.id}: ${violation.help}\n${violation.nodes
            .map((node) => `  ${node.target.join(' ')} — ${node.failureSummary}`)
            .join('\n')}`,
      )
      .join('\n');
    throw new Error(`Accessibility violations:\n${summary}`);
  }
  console.log(
    `Axe passed: ${scans.length} surfaces across desktop and mobile, ${scans.reduce((total, scan) => total + scan.results.passes.length, 0)} rule checks, no serious or critical violations.`,
  );
} finally {
  await browser.close();
  await server.close();
}
