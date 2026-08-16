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
  assert(
    await desktop.locator('#home-screen').isVisible(),
    'The new home screen must be visible on first load.',
  );
  assert(
    (await desktop.locator('[data-home-action]').count()) === 4,
    'Home must expose New game, Continue, Rules and Tutorial.',
  );
  assert(
    (await desktop.locator('#home-settings-button, #home-sound-button').count()) === 2,
    'Home quick settings and sound controls are missing.',
  );
  await desktop.waitForFunction(
    () => document.querySelector('#turn-chip')?.textContent?.includes('Ámbar en mando'),
    undefined,
    { timeout: 5_000 },
  );
  if (process.env.UI_SCREENSHOT)
    await desktop.screenshot({ path: `${process.env.UI_SCREENSHOT}-home.png` });

  await desktop.locator('[data-home-action="rules"]').click();
  assert(
    (await desktop.locator('[data-rule-section]').count()) === 12,
    'Rules must expose the twelve requested sections.',
  );
  await desktop.locator('[data-rule-search]').fill('capturador');
  const filteredRuleCount = await desktop.locator('[data-rule-section]:not([hidden])').count();
  assert(
    filteredRuleCount > 0 &&
      filteredRuleCount < 12 &&
      !(await desktop.locator('[data-rule-section="capturador"]').isHidden()),
    'Rules search must filter the navigation.',
  );
  const filteredTab = desktop.locator('[data-rule-section="capturador"]');
  await filteredTab.focus();
  await filteredTab.press('ArrowDown');
  assert(
    !(await desktop.locator('[data-rule-section][aria-selected="true"]').isHidden()),
    'Keyboard navigation must not activate a filtered-out rules section.',
  );
  await desktop.locator('[data-rule-search]').fill('');
  await filteredTab.focus();
  await filteredTab.press('Enter');
  assert(
    await desktop
      .locator('#rules-article h3')
      .evaluate(
        (heading) =>
          document.activeElement === heading && getComputedStyle(heading).outlineStyle !== 'none',
      ),
    'Keyboard rule activation must retain a visible focus indicator.',
  );
  assert(
    (await desktop.locator('#rules-article').textContent())?.includes(
      'no puede capturar la fortaleza, pero sí puede atacarla desplazándose hasta ella',
    ),
    'Updated Capturer rule is missing.',
  );
  assert(
    await desktop
      .locator('.rule-demo-canvas[data-rule-demo-id="capturador"]')
      .evaluate((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return (
          canvas.getAttribute('role') === 'img' &&
          Boolean(canvas.getAttribute('aria-label')) &&
          rect.width > 0 &&
          rect.height > 0
        );
      }),
    'Capturer rules must mount a visible, accessible game-board demonstration.',
  );
  await desktop
    .locator('.rule-demo-canvas[data-rule-demo-scene="2/3"]')
    .waitFor({ timeout: 6_000 });
  assert(
    (await desktop.locator('#rules-article strong').allTextContents()).some(
      (text) => text === 'capturar',
    ) &&
      (await desktop
        .locator('#rules-article p')
        .first()
        .evaluate((paragraph) => getComputedStyle(paragraph).textAlign)) === 'justify',
    'Rules must preserve the document emphasis and justified alignment.',
  );

  await desktop.locator('[data-rule-section="fortaleza"]').click();
  assert(
    await desktop.locator('#rules-article').evaluate((article) => {
      const headings = [...article.querySelectorAll('.rules-copy h3')];
      if (headings.length !== 2) return false;
      const primary = getComputedStyle(headings[0]);
      const shield = getComputedStyle(headings[1]);
      return primary.fontFamily === shield.fontFamily && primary.fontSize === shield.fontSize;
    }),
    'Fortaleza and Escudo antiaéreo must share the same title role.',
  );

  await desktop.locator('[data-rule-section="desarrollo"]').click();
  assert(
    (await desktop.locator('#rules-article').textContent())?.includes(
      'La disposición inicial de los ejércitos sobre el tablero es la que aparece en la imagen de la derecha.',
    ),
    'Updated initial-deployment wording is missing.',
  );
  await desktop.locator('.rule-media img').waitFor();

  await desktop.locator('[data-rule-section="casillas-compartidas"]').click();
  assert(
    (await desktop.locator('#rules-article').textContent())?.includes(
      'tanto el tanque como el lanzamisiles pueden ser abandonados para convertirse en soldados',
    ),
    'Updated shared-cell attack wording is missing.',
  );
  if (process.env.UI_SCREENSHOT)
    await desktop.screenshot({ path: `${process.env.UI_SCREENSHOT}-rules.png` });
  await desktop.locator('.rules-close').click();

  await desktop.locator('[data-home-action="new"]').click();
  assert(
    (await desktop.locator('[data-home-mode]').count()) === 2 &&
      (await desktop.locator('.home-nav-button.unavailable').isDisabled()),
    'New game menu must expose two playable modes and disabled online play.',
  );
  await desktop.locator('[data-home-mode="local"]').click();
  assert(
    await desktop.evaluate(
      () =>
        document.documentElement.classList.contains('modal-open') &&
        getComputedStyle(document.body).position === 'fixed',
    ),
    'Opening a modal must lock background scrolling.',
  );
  assert(
    (await desktop.locator('[data-fortress-hp]').inputValue()) === '1',
    'Fortress health must default to the recommended 1 HP.',
  );
  const initialLayout = desktop.locator('[data-initial-layout]');
  assert((await initialLayout.inputValue()) === '1', 'Initial layout must default to option 1.');
  await initialLayout.selectOption('2');
  await desktop.locator('[data-start-free]').click();
  await desktop.locator('#game-dialog').waitFor({ state: 'hidden' });
  assert(
    await desktop.evaluate(() => !document.documentElement.classList.contains('modal-open')),
    'Closing a modal must restore the page scroll state.',
  );
  assert((await desktop.title()) === 'Protocolo Hexagonal', 'Document title missing.');
  const threatToggle = desktop.locator('#threat-toggle');
  assert(
    (await threatToggle.getAttribute('aria-pressed')) === 'false',
    'Threat overlay must start disabled.',
  );
  await threatToggle.click();
  assert(
    (await threatToggle.getAttribute('aria-pressed')) === 'true',
    'Threat overlay toggle did not activate.',
  );
  assert(
    await threatToggle.evaluate((button) => button.classList.contains('active')),
    'Threat overlay active state is not visible.',
  );
  assert(
    (await desktop.locator('#sr-board [role="gridcell"]').count()) === 91,
    'Accessible board must expose 91 cells.',
  );
  assert(
    (await desktop.locator('#sr-board [data-hex="3,-4"]').textContent())?.startsWith('CAP,') &&
      (await desktop.locator('#sr-board [data-hex="-3,-1"]').textContent())?.startsWith('CAP,') &&
      (await desktop.locator('#sr-board [data-hex="0,-3"]').textContent())?.startsWith('LMS,'),
    'Initial layout option 2 did not swap Capturadores and Lanzamisiles.',
  );
  assert(
    !(await desktop.locator('#sr-board [role="gridcell"]').allTextContents()).some((label) =>
      label.includes('}'),
    ),
    'Accessible cell labels contain stray template characters.',
  );
  const healthBars = await desktop.locator('.hp i').all();
  assert(healthBars.length === 2, 'The default 1 HP match must expose two health indicators.');
  assert(
    (await desktop.locator('.hp svg path').count()) === 2,
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
    (await desktop.locator('.accessibility-settings .toggle-row').count()) >= 2,
    'Accessibility options missing.',
  );
  const fixedBoardToggle = desktop.locator('[data-pref="fixed-board"]');
  const boardDepthToggle = desktop.locator('[data-pref="board-depth"]');
  assert((await boardDepthToggle.count()) === 1, '2.5D board option missing.');
  assert(!(await boardDepthToggle.isChecked()), 'The board must use 2D by default.');
  await boardDepthToggle.check();
  assert(
    (await desktop.locator('#game-canvas').getAttribute('data-perspective')) === '2.5d',
    'Enabling 2.5D must update the canvas perspective.',
  );
  assert(
    (await desktop.locator('#game-canvas').getAttribute('data-perspective-transition')) === 'true',
    'Changing perspective must start a transition.',
  );
  await desktop.locator('#game-canvas:not([data-perspective-transition])').waitFor();
  await boardDepthToggle.uncheck();
  await desktop.locator('#game-canvas:not([data-perspective-transition])').waitFor();
  assert(
    (await desktop.locator('#game-canvas').getAttribute('data-perspective')) === '2d',
    'Disabling 2.5D must restore the flat board.',
  );
  assert((await fixedBoardToggle.count()) === 1, 'Fixed-board option missing.');
  assert(await fixedBoardToggle.isChecked(), 'Fixed-board option must be enabled by default.');
  await fixedBoardToggle.uncheck();
  await fixedBoardToggle.check();
  assert(
    await desktop.evaluate(
      () => JSON.parse(localStorage.getItem('atlas-preferences-v1') ?? '{}').fixedBoard === true,
    ),
    'Fixed-board preference must be persisted.',
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

  await clickHex(desktop, 0, -2);
  await desktop.locator('#piece-card h2').waitFor({ state: 'visible' });
  assert(
    (await desktop.locator('#piece-card h2').textContent())?.includes('Soldado'),
    'Canvas selection failed.',
  );
  await clickHex(desktop, 0, -2);
  assert(
    (await desktop.locator('#piece-card h2').textContent())?.includes('Esperando selecci'),
    'Clicking the selected piece must deselect it.',
  );
  await clickHex(desktop, 0, 2);
  assert(
    (await desktop.locator('#piece-card h2').textContent())?.includes('Soldado'),
    'Enemy unit inspection failed.',
  );
  assert(
    (await desktop.locator('#action-controls').textContent())?.includes('Vista rival'),
    'Enemy inspection must explain that its markers are not actionable.',
  );
  assert(
    (await desktop
      .locator('#sr-board [role="gridcell"]', { hasText: 'Amenazas potenciales' })
      .count()) > 0,
    'Enemy inspection must expose potential threats to assistive technology.',
  );
  await clickHex(desktop, 0, -2);

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

  await doubleClickHex(desktop, 0, -1);
  await desktop.locator('#turn-chip').getByText('Ámbar en mando').waitFor();
  assert(
    (await desktop.locator('#game-canvas').getAttribute('data-viewpoint')) === 'blue',
    'Fixed board must keep Cian below during the Ámbar turn.',
  );
  assert(
    (await desktop.locator('#game-canvas').getAttribute('data-rotating')) === null,
    'Fixed board must not start a turn rotation.',
  );
  await desktop.locator('#game-canvas').focus();
  await desktop.keyboard.press('s');
  assert(
    (await selectedHex(desktop)) === '0,-2',
    'Keyboard navigation must stay aligned with the fixed Cian viewpoint.',
  );
  await desktop.locator('#settings-button').click();
  await desktop.locator('[data-pref="fixed-board"]').uncheck();
  await desktop.locator('#game-canvas[data-viewpoint="amber"]').waitFor();
  await desktop.locator('[data-dialog-close]').click();
  if (process.env.UI_SCREENSHOT)
    await desktop.screenshot({ path: `${process.env.UI_SCREENSHOT}-amber.png` });
  assert(
    (await desktop.locator('#battle-log li').count()) >= 1,
    'Confirmed action missing from battle log.',
  );

  const cannonPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(cannonPage, runtimeErrors);
  await cannonPage.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await selectMode(cannonPage, 'local');
  await clickHex(cannonPage, 1, -3);
  assert(
    (await cannonPage.locator('#piece-card h2').textContent())?.includes('Tanque'),
    'Tank selection failed.',
  );
  const mediumMoves = cannonPage
    .locator('#sr-board [role="gridcell"]')
    .filter({ hasText: 'Tanque se moverá' });
  const mediumMoveCount = await mediumMoves.count();
  assert(mediumMoveCount > 0, 'Medium tank must have a legal move for compact compass test.');
  const targetKey = await mediumMoves.nth(mediumMoveCount - 1).getAttribute('data-hex');
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
  assert(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Mobile home screen causes horizontal overflow.',
  );
  if (process.env.UI_SCREENSHOT)
    await mobile.screenshot({ path: `${process.env.UI_SCREENSHOT}-mobile-home.png` });
  await selectMode(mobile, 'local');
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
  if (process.env.UI_SCREENSHOT)
    await mobile.screenshot({ path: `${process.env.UI_SCREENSHOT}-mobile-game.png` });
  assert(
    await mobile.locator('#mobile-new-game-button').isVisible(),
    'Mobile new-game control is hidden.',
  );
  await assertTopActionsDoNotOverlap(mobile);

  await mobile.locator('#game-canvas').focus();
  await mobile.keyboard.press('e');
  assert((await selectedHex(mobile)) === '1,0', 'E must move in the sixth hexagonal direction.');
  await mobile.keyboard.press('a');
  assert((await selectedHex(mobile)) === '0,0', 'A must move opposite to E.');
  await mobile.keyboard.press('s');
  assert(
    (await selectedHex(mobile)) === '0,-1',
    'S must move focus toward the bottom of the rotated board.',
  );
  await mobile.keyboard.press('s');
  await mobile.keyboard.press('Enter');
  await mobile.locator('#piece-card h2').waitFor({ state: 'visible' });
  assert(
    (await mobile.locator('#piece-card h2').textContent())?.includes('Soldado'),
    'Keyboard hex navigation failed.',
  );
  await mobile.keyboard.press('w');
  assert((await selectedHex(mobile)) === '0,-1', 'W must move focus onto the soldier destination.');
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
  await selectMode(narrow, 'local');
  await assertTopActionsDoNotOverlap(narrow);
  assert(
    await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Narrow mobile header causes horizontal overflow.',
  );
  await narrow.close();

  const academy = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(academy, runtimeErrors);
  await academy.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  const modeCardHeights = await academy
    .locator('.home-nav-button')
    .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height));
  assert(
    modeCardHeights.every((height) => height <= 140),
    'Home navigation should use a compact, scannable height.',
  );
  await academy.locator('[data-home-action="tutorial"]').click();
  assert(
    await academy
      .locator('[data-scenario="movement"]')
      .evaluate((element) => getComputedStyle(element).cursor === 'pointer'),
    'Scenario cards must expose a pointer cursor.',
  );
  await academy.locator('[data-scenario="movement"]').hover();
  assert(
    await academy
      .locator('[data-scenario="movement"]')
      .evaluate((element) => getComputedStyle(element).transform !== 'none'),
    'Scenario cards must animate on hover.',
  );
  await academy.locator('[data-scenario="movement"]').click();
  assert(
    (await academy.locator('.scenario-steps li').count()) >= 3,
    'Academy briefing must explain the exercise step by step.',
  );
  await academy.locator('[data-dialog-close]').click();
  await academy.locator('#game-canvas').focus();
  await academy.keyboard.press('Enter');
  await academy.keyboard.press('s');
  await academy.keyboard.press('Enter');
  await academy.keyboard.press('Enter');
  await academy.getByText('OBJETIVO COMPLETADO').waitFor();
  assert(
    (await academy.getByText('Tablas por bloqueo').count()) === 0,
    'Academy completion must not report a classical blockade draw.',
  );
  await academy.locator('[data-academy-menu]').click();
  await academy.keyboard.press('Escape');
  await academy.locator('#settings-button').click();
  await academy.locator('[data-open-replay]').click();
  assert(
    await academy.locator('.replay-dock').isVisible(),
    'Replay controls must use a board dock.',
  );
  assert(
    await academy.locator('#game-canvas').isVisible(),
    'The board must remain visible while reviewing history.',
  );
  assert(
    !(await academy.locator('#game-dialog').isVisible()),
    'Replay must not occupy the screen as a modal dialog.',
  );
  await academy.locator('[data-replay-step="-1"]').click();
  assert(
    (await academy.locator('[data-replay-output]').textContent()) === '0',
    'Replay dock must navigate to the initial position.',
  );
  await academy.locator('[data-replay-close]').click();
  await academy.reload({ waitUntil: 'networkidle' });
  assert(
    await academy
      .locator('[data-home-action="continue"]')
      .evaluate((element) => getComputedStyle(element).cursor === 'pointer'),
    'Continue card must expose a pointer cursor.',
  );
  await academy.close();

  const solo = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(solo, runtimeErrors);
  await solo.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await selectMode(solo, 'machine');
  assert(
    await solo.locator('#blockade-button').isHidden(),
    'Draw proposals must be hidden when there is no second human player.',
  );
  await clickHex(solo, 0, -2);
  await doubleClickHex(solo, 0, -1);
  await solo.locator('#battle-log li').nth(1).waitFor({ state: 'attached', timeout: 10_000 });
  await solo.locator('#turn-chip').getByText('Cian en mando').waitFor();
  assert(
    (await solo.locator('#battle-log li').count()) >= 2,
    'The machine must answer the human move with a legal move.',
  );
  assert(
    (await solo.locator('#game-canvas').getAttribute('data-viewpoint')) === 'blue',
    'Solo mode must keep the board viewed from the human side.',
  );
  await solo.locator('#settings-button').click();
  await solo.locator('[data-undo-match]').click();
  await solo.locator('#turn-chip').getByText('Cian en mando').waitFor();
  assert(
    (await solo.locator('#battle-log li:not(.empty-log)').count()) === 0,
    'Undo after a machine response must return to the human decision before both orders.',
  );
  await solo.waitForTimeout(1_000);
  assert(
    (await solo.locator('#battle-log li:not(.empty-log)').count()) === 0,
    'Undo must cancel stale machine calculations instead of committing another order.',
  );
  assert(
    !(await solo.locator('#turn-chip').textContent())?.includes('Pensando'),
    'Undo must clear the machine thinking state.',
  );

  await clickHex(solo, 0, -2);
  await doubleClickHex(solo, 0, -1);
  await solo.locator('#turn-chip').getByText('Máquina pensando…').waitFor();
  await solo.locator('#settings-button').click();
  await solo.locator('[data-undo-match]').click();
  await solo.locator('#turn-chip').getByText('Cian en mando').waitFor();
  await solo.waitForTimeout(1_000);
  assert(
    (await solo.locator('#battle-log li:not(.empty-log)').count()) === 0,
    'Undo while the machine is thinking must cancel its pending response.',
  );
  await solo.close();

  assert(runtimeErrors.length === 0, `Browser runtime errors:\n${runtimeErrors.join('\n')}`);
  console.log('UI smoke passed: desktop action flow, mobile 390px layout, keyboard navigation.');
} finally {
  await browser.close();
  await server.close();
}

async function clickHex(page, q, r) {
  const point = await pointForHex(page, q, r);
  await page.mouse.click(point.x, point.y);
}

async function selectMode(page, mode) {
  if (await page.locator('#home-screen').isVisible()) {
    if (!(await page.locator(`[data-home-mode="${mode}"]`).isVisible()))
      await page.locator('[data-home-action="new"]').click();
    await page.locator(`[data-home-mode="${mode}"]`).click();
  } else {
    await page.locator(`[data-game-mode="${mode}"]`).click();
  }
  await page.locator('[data-start-free]').click();
  await page.locator('#game-dialog').waitFor({ state: 'hidden' });
}

async function doubleClickHex(page, q, r) {
  const point = await pointForHex(page, q, r);
  await page.mouse.dblclick(point.x, point.y);
}

async function pointForHex(page, q, r) {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  assert(box, 'Canvas has no layout box.');
  const perspective = await canvas.getAttribute('data-perspective');
  const verticalExtent = perspective === '2.5d' ? 500 : 610;
  const fitScale = Math.max(
    0.38,
    Math.min((box.width - 34) / 560, (box.height - 42) / verticalExtent),
  );
  const worldX = 45 * q;
  const worldY = Math.sqrt(3) * 30 * (r + q / 2);
  const viewpoint = await canvas.getAttribute('data-viewpoint');
  const orientation = viewpoint === 'blue' ? Math.PI : 0;
  const tilt = perspective === '2.5d' ? 0.72 : 1;
  const screenX = Math.cos(orientation) * worldX - Math.sin(orientation) * worldY;
  const screenY = (Math.sin(orientation) * worldX + Math.cos(orientation) * worldY) * tilt;
  return {
    x: box.x + box.width / 2 + screenX * fitScale,
    y: box.y + box.height / 2 + screenY * fitScale,
  };
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
