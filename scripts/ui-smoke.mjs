import { existsSync } from 'node:fs';

import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const candidates = process.platform === 'win32'
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

const server = await createServer({
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
});
await server.listen();

const browser = await chromium.launch({ executablePath, headless: true });
const runtimeErrors = [];

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(desktop, runtimeErrors);
  await desktop.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  assert((await desktop.title()) === 'Atlas de Asedio', 'Document title missing.');
  assert((await desktop.locator('#sr-board [role="gridcell"]').count()) === 91, 'Accessible board must expose 91 cells.');
  const healthBars = await desktop.locator('.hp i').all();
  assert(healthBars.length === 4, 'Fortress score must expose four health bars.');
  for (const bar of healthBars) {
    const box = await bar.boundingBox();
    assert(box && box.width > 0 && box.height > 0, 'Fortress health bar is visually empty.');
  }
  if (process.env.UI_SCREENSHOT) await desktop.screenshot({ path: `${process.env.UI_SCREENSHOT}-main.png` });

  await desktop.locator('#settings-button').click();
  assert((await desktop.locator('[data-volume]').count()) === 3, 'Options must expose three volume sliders.');
  assert((await desktop.locator('.accessibility-settings .toggle-row').count()) === 2, 'Accessibility options missing.');
  if (process.env.UI_SCREENSHOT) await desktop.screenshot({ path: `${process.env.UI_SCREENSHOT}-options.png` });
  await desktop.locator('[data-volume="masterVolume"]').fill('42');
  assert((await desktop.locator('[data-volume="masterVolume"] + output').textContent()) === '42%', 'Volume output is not synchronized.');
  await desktop.locator('[data-dialog-close]').click();

  await clickHex(desktop, 0, -3);
  await desktop.locator('#piece-card h2').waitFor({ state: 'visible' });
  assert((await desktop.locator('#piece-card h2').textContent())?.includes('Soldado'), 'Canvas selection failed.');

  await clickHex(desktop, 0, -2);
  await desktop.locator('#pending-card:not([hidden])').waitFor();
  assert(await desktop.locator('#pending-card .confirm-button').isEnabled(), 'Prepared action cannot be confirmed.');
  await desktop.locator('#pending-card .confirm-button').click();
  await desktop.locator('#turn-chip').getByText('Ámbar en mando').waitFor();
  assert((await desktop.locator('#battle-log li').count()) >= 1, 'Confirmed action missing from battle log.');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  watchErrors(mobile, runtimeErrors);
  await mobile.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  const layout = await mobile.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    canvasWidth: document.querySelector('canvas')?.getBoundingClientRect().width ?? 0,
  }));
  assert(layout.documentWidth <= layout.viewport, `Mobile horizontal overflow: ${layout.documentWidth}px > ${layout.viewport}px.`);
  assert(layout.canvasWidth <= layout.viewport, 'Canvas exceeds mobile viewport.');
  assert(await mobile.locator('#mobile-new-game-button').isVisible(), 'Mobile new-game control is hidden.');

  await mobile.locator('#game-canvas').focus();
  await mobile.keyboard.press('e');
  assert((await selectedHex(mobile)) === '0,0', 'E must not move keyboard focus.');
  await mobile.keyboard.press('s');
  assert((await selectedHex(mobile)) === '0,1', 'S must move keyboard focus south.');
  await mobile.keyboard.press('w');
  await mobile.keyboard.press('w');
  await mobile.keyboard.press('w');
  await mobile.keyboard.press('w');
  await mobile.keyboard.press('Enter');
  await mobile.locator('#piece-card h2').waitFor({ state: 'visible' });
  assert((await mobile.locator('#piece-card h2').textContent())?.includes('Soldado'), 'Keyboard hex navigation failed.');

  assert(runtimeErrors.length === 0, `Browser runtime errors:\n${runtimeErrors.join('\n')}`);
  console.log('UI smoke passed: desktop action flow, mobile 390px layout, keyboard navigation.');
} finally {
  await browser.close();
  await server.close();
}

async function clickHex(page, q, r) {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  assert(box, 'Canvas has no layout box.');
  const fitScale = Math.max(0.38, Math.min((box.width - 34) / 560, (box.height - 34) / 610));
  const worldX = 45 * q;
  const worldY = Math.sqrt(3) * 30 * (r + q / 2);
  await page.mouse.click(box.x + box.width / 2 + worldX * fitScale, box.y + box.height / 2 + worldY * fitScale);
}

async function selectedHex(page) {
  return page.locator('#sr-board [aria-selected="true"]').getAttribute('data-hex');
}

function watchErrors(page, errors) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
