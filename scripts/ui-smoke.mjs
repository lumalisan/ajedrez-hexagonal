import { existsSync } from 'node:fs';

import { chromium } from 'playwright-core';
import { createServer } from 'vite';

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
  assert((await desktop.title()) === 'Protocolo Hexagonal', 'Document title missing.');
  assert(
    (await desktop.locator('#sr-board [role="gridcell"]').count()) === 91,
    'Accessible board must expose 91 cells.',
  );
  const healthBars = await desktop.locator('.hp i').all();
  assert(healthBars.length === 4, 'Fortress score must expose four health bars.');
  assert(
    (await desktop.locator('.hp svg path').count()) === 4,
    'Fortress health must use heart icons.',
  );
  for (const bar of healthBars) {
    const box = await bar.boundingBox();
    assert(box && box.width > 0 && box.height > 0, 'Fortress health bar is visually empty.');
  }
  if (process.env.UI_SCREENSHOT)
    await desktop.screenshot({ path: `${process.env.UI_SCREENSHOT}-main.png` });

  await desktop.locator('#settings-button').click();
  assert(
    (await desktop.locator('[data-volume]').count()) === 3,
    'Options must expose three volume sliders.',
  );
  assert(
    (await desktop.locator('.accessibility-settings .toggle-row').count()) === 2,
    'Accessibility options missing.',
  );
  if (process.env.UI_SCREENSHOT)
    await desktop.screenshot({ path: `${process.env.UI_SCREENSHOT}-options.png` });
  await desktop.locator('[data-volume="masterVolume"]').fill('42');
  assert(
    (await desktop.locator('[data-volume="masterVolume"] + output').textContent()) === '42%',
    'Volume output is not synchronized.',
  );
  await desktop.locator('[data-dialog-close]').click();

  await desktop.locator('#help-button').click();
  const keyboardGap = await desktop
    .locator('.game-dialog details + .keyboard-card')
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).marginTop));
  assert(keyboardGap >= 16, 'Help keyboard section needs separation from tactical rules.');
  await desktop.locator('[data-dialog-close]').click();

  await clickHex(desktop, 0, -3);
  await desktop.locator('#piece-card h2').waitFor({ state: 'visible' });
  assert(
    (await desktop.locator('#piece-card h2').textContent())?.includes('Soldado'),
    'Canvas selection failed.',
  );

  await desktop.locator('[data-command="rotate"]').click();
  const visualNorth = desktop.locator('.hex-compass button[aria-label="N, orientación actual"]');
  const visualSouth = desktop.locator('.hex-compass button[aria-label="S"]');
  assert(
    (await visualNorth.getAttribute('data-direction-order')) === '3',
    'Cian visual north must map to model south.',
  );
  assert(
    (await visualSouth.getAttribute('data-direction-order')) === '0',
    'Cian visual south must map to model north.',
  );
  assert(!(await visualNorth.isEnabled()), 'The initial Cian soldier must visibly face north.');
  assert(
    (await desktop.locator('.hex-compass .compass-direction').count()) === 6,
    'Direction compass must expose six spatial choices.',
  );
  if (process.env.UI_SCREENSHOT)
    await desktop.screenshot({ path: `${process.env.UI_SCREENSHOT}-compass.png` });
  await visualSouth.click();
  assert(
    (await desktop.locator('.hex-compass .compass-center strong').textContent()) === 'S',
    'Compass center must reflect the selected direction.',
  );
  assert(
    (await desktop
      .locator('.hex-compass .compass-direction.active')
      .getAttribute('data-direction-order')) === '0',
    'Selected compass sector must stay highlighted.',
  );
  await desktop.locator('.cancel-mode').click();

  await doubleClickHex(desktop, 0, -2);
  await desktop.locator('#game-canvas[data-rotating="true"]').waitFor();
  await desktop.locator('#game-canvas[data-viewpoint="amber"]').waitFor();
  if (process.env.UI_SCREENSHOT)
    await desktop.screenshot({ path: `${process.env.UI_SCREENSHOT}-amber.png` });
  await desktop.locator('#turn-chip').getByText('Ámbar en mando').waitFor();
  assert(
    (await desktop.locator('#battle-log li').count()) >= 1,
    'Confirmed action missing from battle log.',
  );

  const cannonPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(cannonPage, runtimeErrors);
  await cannonPage.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await clickHex(cannonPage, 2, -5);
  assert(
    (await cannonPage.locator('#piece-card h2').textContent())?.includes('Tanque medio'),
    'Medium tank selection failed.',
  );
  const mediumMoves = cannonPage
    .locator('#sr-board [role="gridcell"]')
    .filter({ hasText: 'Tanque medio se moverá' });
  const mediumMoveCount = await mediumMoves.count();
  assert(mediumMoveCount > 0, 'Medium tank must have a legal move for compact compass test.');
  const targetKey = await mediumMoves.nth(0).getAttribute('data-hex');
  const [targetQ, targetR] = targetKey.split(',').map(Number);
  await clickHex(cannonPage, targetQ, targetR);
  assert(
    (await cannonPage.locator('.hex-compass.compact .compass-direction').count()) === 6,
    'Post-move cannon compass must expose six choices.',
  );
  if (process.env.UI_SCREENSHOT)
    await cannonPage.screenshot({ path: `${process.env.UI_SCREENSHOT}-compact-compass.png` });
  await cannonPage.close();

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  watchErrors(mobile, runtimeErrors);
  await mobile.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  const layout = await mobile.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    canvasWidth: document.querySelector('canvas')?.getBoundingClientRect().width ?? 0,
  }));
  assert(
    layout.documentWidth <= layout.viewport,
    `Mobile horizontal overflow: ${layout.documentWidth}px > ${layout.viewport}px.`,
  );
  assert(layout.canvasWidth <= layout.viewport, 'Canvas exceeds mobile viewport.');
  assert(
    await mobile.locator('#mobile-new-game-button').isVisible(),
    'Mobile new-game control is hidden.',
  );
  await assertTopActionsDoNotOverlap(mobile);

  await mobile.locator('#game-canvas').focus();
  await mobile.keyboard.press('e');
  assert((await selectedHex(mobile)) === '0,0', 'E must not move keyboard focus.');
  await mobile.keyboard.press('s');
  assert(
    (await selectedHex(mobile)) === '0,-1',
    'S must move focus toward the bottom of the rotated board.',
  );
  await mobile.keyboard.press('s');
  await mobile.keyboard.press('s');
  await mobile.keyboard.press('Enter');
  await mobile.locator('#piece-card h2').waitFor({ state: 'visible' });
  assert(
    (await mobile.locator('#piece-card h2').textContent())?.includes('Soldado'),
    'Keyboard hex navigation failed.',
  );
  await mobile.keyboard.press('w');
  assert((await selectedHex(mobile)) === '0,-2', 'W must move focus onto the soldier destination.');
  await mobile.keyboard.press('Enter');
  await mobile.locator('#pending-card:not([hidden])').waitFor();
  await mobile.keyboard.press('Enter');
  await mobile.locator('#turn-chip').getByText('Ámbar en mando').waitFor();
  assert(
    (await mobile.locator('#battle-log li').count()) >= 1,
    'Second Enter on the prepared destination must execute the order.',
  );

  const narrow = await browser.newPage({
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  watchErrors(narrow, runtimeErrors);
  await narrow.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await assertTopActionsDoNotOverlap(narrow);
  assert(
    await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Narrow mobile header causes horizontal overflow.',
  );
  await narrow.close();

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
  const viewpoint = await canvas.getAttribute('data-viewpoint');
  const orientation = viewpoint === 'blue' ? Math.PI : 0;
  const screenX = Math.cos(orientation) * worldX - Math.sin(orientation) * worldY;
  const screenY = Math.sin(orientation) * worldX + Math.cos(orientation) * worldY;
  await page.mouse.click(
    box.x + box.width / 2 + screenX * fitScale,
    box.y + box.height / 2 + screenY * fitScale,
  );
}

async function doubleClickHex(page, q, r) {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  assert(box, 'Canvas has no layout box.');
  const fitScale = Math.max(0.38, Math.min((box.width - 34) / 560, (box.height - 34) / 610));
  const worldX = 45 * q;
  const worldY = Math.sqrt(3) * 30 * (r + q / 2);
  const viewpoint = await canvas.getAttribute('data-viewpoint');
  const orientation = viewpoint === 'blue' ? Math.PI : 0;
  const screenX = Math.cos(orientation) * worldX - Math.sin(orientation) * worldY;
  const screenY = Math.sin(orientation) * worldX + Math.cos(orientation) * worldY;
  await page.mouse.dblclick(
    box.x + box.width / 2 + screenX * fitScale,
    box.y + box.height / 2 + screenY * fitScale,
  );
}

async function assertTopActionsDoNotOverlap(page) {
  const boxes = await page.locator('.top-actions .icon-button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }),
  );
  assert(boxes.length === 3, 'Mobile header must expose all three icon controls.');
  for (let index = 1; index < boxes.length; index += 1) {
    assert(boxes[index - 1].right <= boxes[index].left, 'Mobile header icon controls overlap.');
  }
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
