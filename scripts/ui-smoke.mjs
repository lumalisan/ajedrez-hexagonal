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
  for (const { layout, mode, viewport } of [
    { layout: '3', mode: 'local', viewport: { width: 1440, height: 900 } },
    { layout: '4', mode: 'machine', viewport: { width: 390, height: 844 } },
  ]) {
    const page = await browser.newPage({ viewport });
    watchErrors(page, runtimeErrors);
    await page.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
    await page.locator('[data-home-action="new"]').click();
    await page.locator(`[data-home-mode="${mode}"]`).click();
    await page.locator('[data-preset="custom"]').click();
    const layoutSelect = page.getByLabel('Disposición inicial');
    assert(
      (await layoutSelect.locator('option').allTextContents()).join('|') ===
        'Frente clásico|Columnas de asedio|Frente blindado|Frente de infantería',
      'All four initial layouts must be available, preserving the existing options.',
    );
    const preview = page.locator('[data-layout-preview]');
    const previewImages = new Set();
    let previewSize;
    for (const [value, soldiers, tanks, capturers, launchers, airplanes] of [
      ['1', 5, 2, 1, 2, 2],
      ['2', 5, 2, 2, 1, 2],
      ['3', 5, 4, 1, 1, 1],
      ['4', 7, 2, 1, 1, 1],
    ]) {
      await layoutSelect.selectOption(value);
      await layoutSelect.focus();
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const rendered = await preview.evaluate((canvas) => ({
        image: canvas.toDataURL(),
        width: canvas.getBoundingClientRect().width,
        height: canvas.getBoundingClientRect().height,
        layout: canvas.dataset.layout,
      }));
      assert(rendered.layout === value, 'The preview must follow the selected layout.');
      assert(rendered.width > 200 && rendered.height > 100, 'Preview must remain readable.');
      const size = `${rendered.width},${rendered.height}`;
      previewSize ??= size;
      assert(size === previewSize, 'Changing layouts must preserve the preview frame.');
      previewImages.add(rendered.image);
      const roster = await page
        .locator('#layout-preview-roster > div')
        .evaluateAll((rows) =>
          Object.fromEntries(
            rows.map((row) => [
              row.querySelector('dt').textContent,
              Number(row.querySelector('dd').textContent),
            ]),
          ),
        );
      assert(
        roster.Soldado === soldiers &&
          roster.Tanque === tanks &&
          roster.Capturador === capturers &&
          roster.Lanzamisiles === launchers &&
          roster.Avión === airplanes &&
          Object.values(roster).reduce((total, count) => total + count, 0) === 18,
        `Layout ${value} must describe the actual army in text.`,
      );
      assert(
        await layoutSelect.evaluate((select) => select === document.activeElement),
        'Updating the preview must preserve keyboard focus.',
      );
    }
    assert(previewImages.size === 4, 'Each layout must produce a different board preview.');
    await layoutSelect.press('Home');
    await layoutSelect.press('ArrowDown');
    assert(
      (await preview.getAttribute('data-layout')) === '2',
      'Keyboard selection must update the preview.',
    );
    const beforeHealth = await preview.evaluate((canvas) => canvas.toDataURL());
    await page.locator('[data-fortress-hp]').selectOption('3');
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert(
      (await preview.evaluate((canvas) => canvas.toDataURL())) !== beforeHealth,
      'Fortress health changes must be reflected in the preview.',
    );
    await page.locator('[data-fortress-hp]').selectOption('2');
    await page.locator('[data-preset="tactical"]').click();
    assert(await preview.isHidden(), 'The custom preview must hide when selecting another preset.');
    await page.locator('[data-preset="custom"]').click();
    assert(
      (await preview.getAttribute('data-layout')) === '2',
      'Returning to custom must preserve the chosen layout.',
    );
    await layoutSelect.selectOption(layout);
    await layoutSelect.focus();
    await page
      .locator('.layout-picker')
      .evaluate((picker) => picker.scrollIntoView({ block: 'start' }));
    await assertNoHorizontalOverflow(page, `Layout ${layout} configuration`, '#game-dialog');
    if (process.env.UI_SCREENSHOT)
      await page.screenshot({ path: `${process.env.UI_SCREENSHOT}-layout-${layout}-config.png` });
    await page.locator('[data-start-free]').click();
    await page.locator('#game-dialog').waitFor({ state: 'hidden' });
    await page.locator('#game-canvas[data-viewpoint="blue"]:not([data-rotating])').waitFor();
    const frontLabel = layout === '3' ? 'TNQ,' : 'SOL,';
    for (const [q, r, label] of [
      [3, -4, frontLabel],
      [-3, -1, frontLabel],
      [1, -5, 'LMS,'],
      [-1, -4, 'AVI,'],
      [0, -3, 'CAP,'],
    ]) {
      for (const sign of [1, -1]) {
        assert(
          (
            await page.locator(`#sr-board [data-hex="${q * sign},${r * sign}"]`).textContent()
          )?.startsWith(label),
          `Layout ${layout} must place ${label} at ${q * sign},${r * sign}.`,
        );
      }
    }
    await assertNoHorizontalOverflow(page, `Layout ${layout} match`);
    if (process.env.UI_SCREENSHOT)
      await page.screenshot({ path: `${process.env.UI_SCREENSHOT}-layout-${layout}-board.png` });
    await page.close();
  }

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(desktop, runtimeErrors);
  await desktop.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  assert(
    await desktop.locator('#home-screen').isVisible(),
    'The new home screen must be visible on first load.',
  );
  assert(
    (await desktop.locator('[data-home-action]').count()) >= 6,
    'Home must expose New game, Continue, Rules, Tutorial, Laboratory and History.',
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
    .waitFor({ timeout: 8_000 });
  assert(
    (await desktop.locator('.rule-demo-canvas').getAttribute('data-perspective')) === '2d',
    'Rules demonstrations must use the flat board.',
  );
  await desktop.locator('[data-demo-toggle]').click();
  await desktop.locator('[data-demo-restart]').click();
  await desktop.locator('[data-demo-step]').click();
  await desktop.locator('[data-demo-step]').click();
  assert(
    (await desktop.locator('.rule-demo-canvas').getAttribute('data-rule-demo-scene')) === '2/3',
    'Rules demonstrations must support pausing, restarting and manual steps.',
  );
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
    (await desktop.locator('[data-home-mode]').count()) === 3 &&
      (await desktop.locator('.home-nav-button.unavailable').count()) === 0,
    'New game menu must expose local, machine and Academy as playable modes.',
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
  await desktop.locator('[data-preset="custom"]').click();
  assert(
    (await desktop.locator('[data-fortress-hp]').inputValue()) === '2',
    'Fortress health must default to the balanced 2 HP.',
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
  assert(healthBars.length === 4, 'The default 2 HP match must expose four health indicators.');
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
  await desktop.getByRole('button', { name: 'Entendido' }).click();

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

  const historyPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(historyPage, runtimeErrors);
  await historyPage.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await selectMode(historyPage, 'local');
  const undoAction = historyPage.locator('#undo-action');
  const redoAction = historyPage.locator('#redo-action');
  assert(
    (await undoAction.isVisible()) && (await redoAction.isVisible()),
    'Local matches must expose undo and redo beside the board view controls.',
  );
  assert(
    (await undoAction.isDisabled()) && (await redoAction.isDisabled()),
    'A new match must disable both history controls.',
  );
  assert(
    (await undoAction.getAttribute('aria-label'))?.includes('Deshacer') &&
      (await redoAction.getAttribute('aria-label'))?.includes('Rehacer'),
    'History arrow buttons must have accessible names.',
  );
  const initialBoard = await historyPage.locator('#sr-board').textContent();
  await clickHex(historyPage, 0, -2);
  await doubleClickHex(historyPage, 0, -1);
  await historyPage.locator('#undo-action:not([disabled])').waitFor();
  await assertActionHistory(historyPage, 1, 1);
  const firstMoveBoard = await historyPage.locator('#sr-board').textContent();
  const firstMoveLog = await historyPage.locator('#battle-log').textContent();
  assert(firstMoveBoard !== initialBoard, 'A committed move must change the board.');
  await undoAction.focus();
  await undoAction.press('Enter');
  await assertActionHistory(historyPage, 0, 1);
  assert(
    (await historyPage.locator('#sr-board').textContent()) === initialBoard &&
      (await historyPage.locator('#battle-log li:not(.empty-log)').count()) === 0 &&
      (await historyPage.locator('#turn-chip').textContent())?.includes('Cian en mando'),
    'Undo must restore the board, turn and battle log before the move.',
  );
  assert(
    (await undoAction.isDisabled()) && (await redoAction.isEnabled()),
    'Undoing the first move must disable undo and enable redo.',
  );
  await redoAction.click();
  await assertActionHistory(historyPage, 1, 1);
  assert(
    (await historyPage.locator('#sr-board').textContent()) === firstMoveBoard &&
      (await historyPage.locator('#battle-log').textContent()) === firstMoveLog &&
      (await historyPage.locator('#turn-chip').textContent())?.includes('Ámbar en mando') &&
      (await redoAction.isDisabled()),
    'Redo must restore the exact board, turn and battle log without duplicating the move.',
  );
  await clickHex(historyPage, 0, 2);
  await doubleClickHex(historyPage, 0, 1);
  assert(
    (await undoAction.isDisabled()) && (await redoAction.isDisabled()),
    'History controls must stay disabled while an order is animating.',
  );
  await historyPage.locator('#undo-action:not([disabled])').waitFor();
  await assertActionHistory(historyPage, 2, 2);
  await undoAction.click();
  await assertActionHistory(historyPage, 1, 2);
  await undoAction.click();
  await assertActionHistory(historyPage, 0, 2);
  assert(
    (await historyPage.locator('#sr-board').textContent()) === initialBoard,
    'Consecutive undo actions must restore the initial position.',
  );
  await historyPage.reload({ waitUntil: 'networkidle' });
  await historyPage.locator('[data-home-action="continue"]').click();
  await assertActionHistory(historyPage, 0, 2);
  assert(
    (await historyPage.locator('#sr-board').textContent()) === initialBoard &&
      (await undoAction.isDisabled()) &&
      (await redoAction.isEnabled()),
    'Continuing after reload must preserve the undo cursor and redo history.',
  );
  await redoAction.click();
  await assertActionHistory(historyPage, 1, 2);
  assert(
    (await historyPage.locator('#sr-board').textContent()) === firstMoveBoard,
    'Redo must remain usable after a saved match is restored.',
  );
  await undoAction.click();
  await clickHex(historyPage, 2, -3);
  await doubleClickHex(historyPage, 2, -2);
  await historyPage.locator('#undo-action:not([disabled])').waitFor();
  await assertActionHistory(historyPage, 1, 1);
  assert(
    (await redoAction.isDisabled()) &&
      (await historyPage.locator('#sr-board').textContent()) !== firstMoveBoard,
    'A different move after undo must replace the discarded future and disable redo.',
  );
  await historyPage.evaluate(() => {
    const key = 'atlas-match-classic-v2';
    const record = JSON.parse(localStorage.getItem(key));
    record.config.options.noProgressPlyLimit = 1;
    record.actions = [];
    record.currentAction = 0;
    localStorage.setItem(key, JSON.stringify(record));
  });
  await historyPage.reload({ waitUntil: 'networkidle' });
  await historyPage.locator('[data-home-action="continue"]').click();
  await clickHex(historyPage, 0, -2);
  await historyPage.locator('[data-command="rotate"]').click();
  await historyPage.locator('[data-direction-order="0"]').click();
  await historyPage.locator('#pending-card .confirm-button').click();
  await historyPage.locator('#game-dialog [data-undo-match]').waitFor();
  const finishedHeading = await historyPage.locator('#game-dialog h2').textContent();
  assert(
    await historyPage.evaluate(
      () =>
        localStorage.getItem('atlas-match-classic-v2') === null &&
        JSON.parse(localStorage.getItem('atlas-match-history-v1') ?? '[]').length === 1,
    ),
    'A terminal order must archive the result and clear the active save.',
  );
  await historyPage.locator('#game-dialog [data-undo-match]').click();
  await assertActionHistory(historyPage, 0, 1);
  assert(
    (await historyPage.locator('#game-dialog').isHidden()) &&
      (await historyPage.locator('#sr-board').textContent()) === initialBoard &&
      (await historyPage.evaluate(
        () => JSON.parse(localStorage.getItem('atlas-match-history-v1') ?? '[]').length,
      )) === 0,
    'Undoing a terminal order must reopen the match and remove the obsolete archived result.',
  );
  await redoAction.click();
  await historyPage.locator('#game-dialog [data-undo-match]').waitFor();
  assert(
    (await historyPage.locator('#game-dialog h2').textContent()) === finishedHeading &&
      (await historyPage.evaluate(
        () =>
          localStorage.getItem('atlas-match-classic-v2') === null &&
          JSON.parse(localStorage.getItem('atlas-match-history-v1') ?? '[]').length === 1,
      )),
    'Redoing a terminal order must restore its result and exactly one history entry.',
  );
  await historyPage.close();

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
  await assertBoardHistoryControlsFit(mobile);
  assert(
    await mobile.locator('.panel-footer').evaluate((footer) => footer.inert),
    'Collapsed command panel controls must be excluded from keyboard and assistive navigation.',
  );
  assert(
    (await mobile.locator('.legend > span:visible').count()) === 6,
    'Portrait mobile must retain every board legend entry.',
  );

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
  assert(
    (await mobile.locator('.command-sheet-label').textContent()) === 'Soldado',
    'The collapsed panel must identify the selected unit.',
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
  await assertBoardHistoryControlsFit(narrow);
  assert(
    await narrow
      .locator('body')
      .evaluate((body) => body.classList.contains('command-sheet-collapsed')),
    'The mobile command sheet must start collapsed.',
  );
  await clickHex(narrow, 0, -2);
  assert(
    await narrow
      .locator('body')
      .evaluate((body) => body.classList.contains('command-sheet-collapsed')),
    'Selecting a piece must keep the mobile command sheet collapsed.',
  );
  await narrow.setViewportSize({ width: 844, height: 390 });
  await narrow.waitForFunction(() => !document.querySelector('.panel-footer').inert);
  await assertBoardHistoryControlsFit(narrow);
  await narrow.setViewportSize({ width: 320, height: 720 });
  await narrow.waitForFunction(() => document.querySelector('.panel-footer').inert);
  await narrow.locator('#command-sheet-toggle').focus();
  await narrow.keyboard.press('Tab');
  assert(
    await narrow.evaluate(() => !document.activeElement.closest('#command-panel > [inert]')),
    'Tab must not enter off-screen command panel controls.',
  );
  await dragCommandSheet(narrow, -150);
  assert(
    await narrow
      .locator('body')
      .evaluate((body) => body.classList.contains('command-sheet-expanded')),
    'Dragging the command sheet upward must expand it.',
  );
  await dragCommandSheet(narrow, 150);
  assert(
    await narrow
      .locator('body')
      .evaluate((body) => body.classList.contains('command-sheet-collapsed')),
    'Dragging the command sheet downward must collapse it.',
  );
  await clickHex(narrow, 0, -1);
  assert(
    await narrow
      .locator('body')
      .evaluate((body) => body.classList.contains('command-sheet-expanded')),
    'Preparing an order must reveal its confirmation controls.',
  );
  assert(
    (await narrow.locator('.command-sheet-chevron').count()) === 0,
    'The command sheet must not render a redundant chevron.',
  );
  const pendingSheetLayout = await narrow.evaluate(() => {
    const panel = document.querySelector('#command-panel')?.getBoundingClientRect();
    const toggle = document.querySelector('#command-sheet-toggle')?.getBoundingClientRect();
    const pending = document.querySelector('#pending-card')?.getBoundingClientRect();
    const piece = document.querySelector('#piece-card');
    const controls = document.querySelector('#action-controls');
    return {
      panel: panel ? { top: panel.top, bottom: panel.bottom } : null,
      toggle: toggle ? { top: toggle.top, bottom: toggle.bottom } : null,
      pending: pending ? { top: pending.top, bottom: pending.bottom } : null,
      pieceDisplay: piece ? getComputedStyle(piece).display : null,
      controlsDisplay: controls ? getComputedStyle(controls).display : null,
      pendingPosition: document.querySelector('#pending-card')
        ? getComputedStyle(document.querySelector('#pending-card')).position
        : null,
    };
  });
  assert(
    pendingSheetLayout.pieceDisplay === 'none' && pendingSheetLayout.controlsDisplay === 'none',
    'Prepared-order mode must replace, not cover, the selection controls.',
  );
  assert(
    pendingSheetLayout.pendingPosition === 'static' &&
      pendingSheetLayout.panel &&
      pendingSheetLayout.toggle &&
      pendingSheetLayout.pending &&
      pendingSheetLayout.pending.top >= pendingSheetLayout.toggle.bottom - 1 &&
      pendingSheetLayout.pending.bottom <= pendingSheetLayout.panel.bottom + 1,
    'Prepared-order controls must flow inside the command sheet without overlap.',
  );
  if (process.env.UI_SCREENSHOT)
    await narrow.screenshot({ path: `${process.env.UI_SCREENSHOT}-mobile-pending.png` });
  await narrow.locator('#command-sheet-toggle').click();
  assert(
    (await narrow.locator('#command-sheet-toggle').getAttribute('aria-expanded')) === 'false' &&
      (await narrow.locator('#pending-card').evaluate((card) => card.inert && !card.hidden)),
    'A pending order must be retained when its panel is collapsed to inspect the board.',
  );
  await narrow.locator('#command-sheet-toggle').click();
  assert(
    (await narrow.locator('#command-sheet-toggle').getAttribute('aria-expanded')) === 'true' &&
      !(await narrow.locator('#pending-card').evaluate((card) => card.inert)),
    'Reopening the panel must make the pending order confirmation accessible again.',
  );
  assert(
    await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Narrow mobile header causes horizontal overflow.',
  );
  await narrow.close();

  const compactPortrait = await browser.newPage({
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
  });
  watchErrors(compactPortrait, runtimeErrors);
  await compactPortrait.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await compactPortrait.locator('[data-home-action="tutorial"]').waitFor();
  await assertNoHorizontalOverflow(compactPortrait, 'Compact portrait home');
  const lastHomeAction = compactPortrait.locator('.home-navigation button').last();
  await lastHomeAction.scrollIntoViewIfNeeded();
  assert(
    await lastHomeAction.evaluate((button) => {
      const utility = document.querySelector('.home-utility-actions').getBoundingClientRect();
      return button.getBoundingClientRect().bottom <= utility.top;
    }),
    'The last home action must scroll fully above the fixed utility area on short phones.',
  );

  await compactPortrait.locator('[data-home-action="new"]').click();
  await compactPortrait.locator('[data-home-mode="local"]').click();
  await compactPortrait.locator('[data-preset="custom"]').click();
  await assertNoHorizontalOverflow(
    compactPortrait,
    'Compact portrait configuration',
    '#game-dialog',
  );
  await assertVisibleFormFontSize(compactPortrait, '#game-dialog', 16);
  await compactPortrait.locator('#game-dialog').evaluate((element) => {
    element.scrollTop = 0;
  });
  const stickyCtaAtTop = await compactPortrait.evaluate(() => {
    const dialog = document.querySelector('#game-dialog');
    const actions = dialog?.querySelector('.dialog-actions');
    const cta = dialog?.querySelector('[data-start-free]');
    if (!dialog || !actions || !cta) return null;
    const dialogRect = dialog.getBoundingClientRect();
    const ctaRect = cta.getBoundingClientRect();
    return {
      position: getComputedStyle(actions).position,
      visible:
        ctaRect.top >= Math.max(0, dialogRect.top) &&
        ctaRect.bottom <= Math.min(window.innerHeight, dialogRect.bottom),
    };
  });
  assert(
    stickyCtaAtTop?.position === 'sticky' && stickyCtaAtTop.visible,
    'The compact configuration CTA must remain sticky and visible at the top of the scroll.',
  );
  await compactPortrait.locator('#game-dialog').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  assert(
    await compactPortrait.locator('[data-start-free]').evaluate((cta) => {
      const rect = cta.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    }),
    'The compact configuration CTA must remain visible after scrolling.',
  );
  await compactPortrait.locator('.config-close').click();
  await compactPortrait.locator('#game-dialog').waitFor({ state: 'hidden' });
  await compactPortrait.locator('[data-home-action="back"]').click();

  const tutorialControl = compactPortrait.locator('[data-home-action="tutorial"]');
  await tutorialControl.click();
  await compactPortrait.locator('.academy-shell').waitFor();
  await assertNoHorizontalOverflow(compactPortrait, 'Compact portrait Academy', '#game-dialog');
  const academyViewport = await compactPortrait.evaluate(() => {
    const dialog = document.querySelector('#game-dialog')?.getBoundingClientRect();
    const catalog = document.querySelector('.academy-catalog')?.getBoundingClientRect();
    return {
      dialog: dialog ? { width: dialog.width, height: dialog.height } : null,
      catalog: catalog ? { width: catalog.width, height: catalog.height } : null,
    };
  });
  assert(
    academyViewport.dialog?.width >= 300 &&
      academyViewport.dialog.height >= 500 &&
      academyViewport.catalog?.width >= 270 &&
      academyViewport.catalog.height >= 200,
    'Academy must retain a useful catalog area at 320x568.',
  );
  await compactPortrait.locator('.academy-close').click();
  await compactPortrait.locator('#game-dialog').waitFor({ state: 'hidden' });
  await compactPortrait.waitForFunction(
    () => document.activeElement?.matches('[data-home-action="tutorial"]'),
    undefined,
    { timeout: 2_000 },
  );

  await compactPortrait.locator('[data-home-action="rules"]').click();
  await compactPortrait.locator('[data-rule-search]').waitFor();
  await assertNoHorizontalOverflow(compactPortrait, 'Compact portrait rules', '#game-dialog');
  await assertVisibleFormFontSize(compactPortrait, '#game-dialog', 16);
  await compactPortrait.locator('[data-rule-search]').fill('unidad completamente inexistente');
  await compactPortrait.locator('.rules-empty').waitFor();
  assert(
    (await compactPortrait.locator('.rules-empty').getAttribute('role')) === 'status' &&
      (await compactPortrait.locator('.rules-empty').textContent())?.includes(
        'Sin coincidencias',
      ) &&
      (await compactPortrait.locator('[data-rule-section]:not([hidden])').count()) === 0,
    'Rules search must present an accessible empty state when there are no results.',
  );
  await assertNoHorizontalOverflow(compactPortrait, 'Compact portrait empty rules', '#game-dialog');
  await compactPortrait.locator('.rules-close').click();
  await compactPortrait.close();

  const compactLandscape = await browser.newPage({
    viewport: { width: 568, height: 320 },
    isMobile: true,
    hasTouch: true,
  });
  watchErrors(compactLandscape, runtimeErrors);
  await compactLandscape.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await selectMode(compactLandscape, 'local');
  await assertNoHorizontalOverflow(compactLandscape, 'Compact landscape match');
  await assertBoardHistoryControlsFit(compactLandscape);
  const landscapeGameLayout = await compactLandscape.evaluate(() => {
    const canvas = document.querySelector('#game-canvas')?.getBoundingClientRect();
    const board = document.querySelector('.board-stage')?.getBoundingClientRect();
    const panel = document.querySelector('#command-panel')?.getBoundingClientRect();
    const panelElement = document.querySelector('#command-panel');
    const toggle = document.querySelector('#command-sheet-toggle');
    return {
      canvasHeight: canvas?.height ?? 0,
      panelWidth: panel?.width ?? 0,
      panelStartsAfterBoard: Boolean(panel && board && panel.left >= board.right - 1),
      panelPosition: panelElement ? getComputedStyle(panelElement).position : null,
      toggleDisplay: toggle ? getComputedStyle(toggle).display : null,
    };
  });
  assert(
    landscapeGameLayout.canvasHeight >= 180,
    `Compact landscape canvas is only ${landscapeGameLayout.canvasHeight}px tall.`,
  );
  assert(
    landscapeGameLayout.panelWidth >= 240 &&
      landscapeGameLayout.panelStartsAfterBoard &&
      landscapeGameLayout.panelPosition === 'relative' &&
      landscapeGameLayout.toggleDisplay === 'none',
    'Compact landscape must use a visible side panel without the mobile sheet toggle.',
  );

  await clickHex(compactLandscape, 0, -2);
  await clickHex(compactLandscape, 0, -1);
  await assertPendingActionsReachable(compactLandscape);
  await compactLandscape.setViewportSize({ width: 844, height: 390 });
  await assertPendingActionsReachable(compactLandscape);
  await compactLandscape.setViewportSize({ width: 568, height: 320 });
  await compactLandscape.locator('#pending-card .confirm-button').click();
  await compactLandscape.locator('#turn-chip').getByText('Ámbar en mando').waitFor();
  await compactLandscape.locator('#settings-button').click();
  await compactLandscape.locator('[data-data-center]').click();
  await compactLandscape.locator('[data-open-replay]').click();
  await compactLandscape.locator('.replay-dock').waitFor();
  await assertHistoryControlsHidden(compactLandscape, 'Replay');
  assert(
    await compactLandscape.evaluate(() => {
      const panel = document.querySelector('#command-panel');
      return (
        document.body.classList.contains('replay-active') &&
        Boolean(panel && getComputedStyle(panel).display === 'none')
      );
    }),
    'Compact landscape replay must hide the side command panel.',
  );
  const replayControlSizes = await compactLandscape
    .locator('.replay-dock button, .replay-dock input')
    .evaluateAll((controls) =>
      controls
        .filter((control) => {
          const style = getComputedStyle(control);
          const rect = control.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
        })
        .map((control) => {
          const rect = control.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            label: control.getAttribute('aria-label'),
          };
        }),
    );
  assert(
    replayControlSizes.length >= 5 &&
      replayControlSizes.every(({ width, height }) => width >= 44 && height >= 44),
    `Replay controls below 44px: ${JSON.stringify(replayControlSizes)}`,
  );
  assert(
    await compactLandscape.locator('.replay-dock').evaluate((dock) => {
      const rect = dock.getBoundingClientRect();
      return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight
      );
    }),
    'Compact landscape replay dock must remain inside the viewport.',
  );
  await compactLandscape.locator('[data-replay-close]').click();
  await compactLandscape.close();

  const clocked = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(clocked, runtimeErrors);
  await clocked.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await clocked.locator('#home-settings-button').click();
  await clocked.locator('[data-pref="handoff"]').check();
  await clocked.locator('[data-dialog-close]').click();
  await clocked.locator('[data-home-action="new"]').click();
  await clocked.locator('[data-home-mode="local"]').click();
  await clocked.locator('[data-match-clock]').selectOption('600');
  await clocked.locator('[data-start-free]').click();
  await clickHex(clocked, 0, -2);
  await doubleClickHex(clocked, 0, -1);
  await clocked.locator('[data-handoff-ready]').waitFor({ timeout: 10_000 });
  const pausedClock = await clocked.evaluate(
    () => JSON.parse(localStorage.getItem('atlas-match-classic-v2')).clock,
  );
  await clocked.waitForTimeout(800);
  const pausedClockAfterWait = await clocked.evaluate(
    () => JSON.parse(localStorage.getItem('atlas-match-classic-v2')).clock,
  );
  assert(
    pausedClock.status === 'paused' &&
      pausedClockAfterWait.remainingMs[1] === pausedClock.remainingMs[1],
    'The next player clock must stay paused while animation or handoff blocks interaction.',
  );
  await clocked.locator('[data-handoff-ready]').click();
  await clocked.waitForTimeout(1_200);
  const runningClock = await clocked.evaluate(
    () => JSON.parse(localStorage.getItem('atlas-match-classic-v2')).clock,
  );
  assert(
    runningClock.status === 'running' &&
      runningClock.activePlayer === 1 &&
      runningClock.remainingMs[1] < pausedClock.remainingMs[1],
    'The next player clock must start only after accepting the handoff.',
  );
  await clocked.locator('#undo-action').click();
  await assertActionHistory(clocked, 0, 1);
  const undoneClock = await clocked.evaluate(
    () => JSON.parse(localStorage.getItem('atlas-match-classic-v2')).clock,
  );
  assert(
    undoneClock.status === 'running' &&
      undoneClock.activePlayer === 0 &&
      undoneClock.remainingMs.every(
        (remaining, player) => remaining <= runningClock.remainingMs[player],
      ),
    'Undo must run the restored player clock without refunding elapsed time.',
  );
  await clocked.locator('#redo-action').click();
  await assertActionHistory(clocked, 1, 1);
  const redoneClock = await clocked.evaluate(
    () => JSON.parse(localStorage.getItem('atlas-match-classic-v2')).clock,
  );
  assert(
    redoneClock.status === 'running' &&
      redoneClock.activePlayer === 1 &&
      redoneClock.remainingMs.every(
        (remaining, player) => remaining <= undoneClock.remainingMs[player],
      ),
    'Redo must run the next player clock without refunding elapsed time.',
  );
  await clocked.evaluate(() => {
    const key = 'atlas-match-classic-v2';
    const record = JSON.parse(localStorage.getItem(key));
    record.clock.remainingMs[record.clock.activePlayer] = 1;
    record.clock.status = 'running';
    record.clock.lastTickAt = Date.now() - 1_000;
    record.clock.timedOutPlayer = null;
    localStorage.setItem(key, JSON.stringify(record));
  });
  await clocked.reload({ waitUntil: 'networkidle' });
  await clocked.locator('[data-home-action="continue"]').click();
  await clocked
    .locator('#game-dialog h2')
    .filter({ hasText: /tiempo/i })
    .waitFor();
  assert(
    await clocked.evaluate(() => {
      const active = localStorage.getItem('atlas-match-classic-v2');
      const history = JSON.parse(localStorage.getItem('atlas-match-history-v1') ?? '[]');
      return active === null && history[0]?.outcome?.reason === 'timeout';
    }),
    'A timeout discovered on resume must be presented, archived and removed from active saves.',
  );
  await clocked.close();

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
    (await academy.locator('.scenario-steps li').count()) === 0,
    'Academy briefing should not expose the solution before asking for help.',
  );
  await academy.locator('[data-reveal-scenario-hint]').click();
  assert(
    (await academy.locator('.scenario-steps li').count()) === 1,
    'Academy must reveal hints progressively.',
  );
  assert(
    await academy.evaluate(() => {
      const record = JSON.parse(localStorage.getItem('atlas-match-classic-v2'));
      return (
        record.academySession?.scenarioId === 'movement' &&
        record.academySession?.hintsRevealed === 1
      );
    }),
    'Academy hint usage must persist with the active match.',
  );
  await academy.locator('[data-dialog-close]').click();
  await assertHistoryControlsHidden(academy, 'Academy');
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
  await academy.locator('[data-data-center]').click();
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
    await academy.locator('[data-home-action="continue"]').isDisabled(),
    'A completed Academy mission must not remain as an active saved match.',
  );
  assert(
    await academy
      .locator('[data-home-action="history"]')
      .evaluate((element) => getComputedStyle(element).cursor === 'pointer'),
    'Completed matches must remain available through History.',
  );
  await academy.close();

  const solo = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(solo, runtimeErrors);
  await solo.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await selectMode(solo, 'machine');
  await assertHistoryControlsHidden(solo, 'Machine matches');
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
  await solo.locator('[data-data-center]').click();
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
  await solo.locator('[data-data-center]').click();
  await solo.locator('[data-undo-match]').click();
  await solo.locator('#turn-chip').getByText('Cian en mando').waitFor();
  await solo.waitForTimeout(1_000);
  assert(
    (await solo.locator('#battle-log li:not(.empty-log)').count()) === 0,
    'Undo while the machine is thinking must cancel its pending response.',
  );
  await solo.close();

  assert(runtimeErrors.length === 0, `Browser runtime errors:\n${runtimeErrors.join('\n')}`);
  console.log(
    'UI smoke passed: desktop flow, local undo/redo and saved history, 320px portrait utilities, 568px landscape replay, mobile keyboard navigation.',
  );
} finally {
  await browser.close();
  await server.close();
}

async function clickHex(page, q, r) {
  const point = await pointForHex(page, q, r);
  await page.mouse.click(point.x, point.y);
}

async function dragCommandSheet(page, deltaY) {
  const toggle = page.locator('#command-sheet-toggle');
  await toggle.click({ trial: true });
  const box = await toggle.boundingBox();
  assert(box, 'Command sheet toggle has no layout box.');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + deltaY, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
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

async function assertPendingActionsReachable(page) {
  await page.locator('#pending-card .confirm-button').waitFor();
  const controls = await page
    .locator('#pending-card .pending-actions button')
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: button.textContent,
          visible:
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth,
          width: rect.width,
          height: rect.height,
        };
      }),
    );
  assert(
    controls.length === 2 &&
      controls.every(({ visible, width, height }) => visible && width >= 44 && height >= 44),
    `Landscape confirmation controls must remain visible and touch accessible: ${JSON.stringify(controls)}.`,
  );
}

async function assertActionHistory(page, currentAction, actionCount) {
  await page.waitForFunction(
    ({ cursor, count }) => {
      const saved = JSON.parse(localStorage.getItem('atlas-match-classic-v2') ?? 'null');
      return saved?.currentAction === cursor && saved?.actions.length === count;
    },
    { cursor: currentAction, count: actionCount },
    { timeout: 5_000 },
  );
}

async function assertHistoryControlsHidden(page, label) {
  assert(
    (await page.locator('#undo-action').isHidden()) &&
      (await page.locator('#redo-action').isHidden()),
    `${label} must hide the local match history controls.`,
  );
}

async function assertBoardHistoryControlsFit(page) {
  const layout = await page.locator('.zoom-controls').evaluate((toolbar) => ({
    viewport: window.innerWidth,
    buttons: [...toolbar.querySelectorAll('button')]
      .filter((button) => button.getBoundingClientRect().width > 0)
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          id: button.id,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      }),
  }));
  assert(
    layout.buttons.length === 6 &&
      layout.buttons.some(({ id }) => id === 'undo-action') &&
      layout.buttons.some(({ id }) => id === 'redo-action'),
    'Mobile board toolbar must show undo, redo, threats and all three view controls.',
  );
  assert(
    layout.buttons.every(
      ({ left, right, width, height }) =>
        left >= 0 && right <= layout.viewport && width >= 44 && height >= 44,
    ),
    `Mobile board controls must fit the viewport with 44px touch targets: ${JSON.stringify(layout)}.`,
  );
  for (let index = 0; index < layout.buttons.length; index += 1) {
    const button = layout.buttons[index];
    for (const other of layout.buttons.slice(index + 1)) {
      assert(
        button.right <= other.left ||
          other.right <= button.left ||
          button.bottom <= other.top ||
          other.bottom <= button.top,
        `Mobile board controls ${button.id} and ${other.id} overlap.`,
      );
    }
  }
}

async function assertNoHorizontalOverflow(page, label, targetSelector) {
  const metrics = await page.evaluate((selector) => {
    const target = selector ? document.querySelector(selector) : null;
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      targetClientWidth: target?.clientWidth ?? null,
      targetScrollWidth: target?.scrollWidth ?? null,
    };
  }, targetSelector);
  assert(
    metrics.documentWidth <= metrics.viewportWidth + 1,
    `${label} overflows horizontally: ${metrics.documentWidth}px > ${metrics.viewportWidth}px.`,
  );
  if (metrics.targetClientWidth !== null && metrics.targetScrollWidth !== null) {
    assert(
      metrics.targetScrollWidth <= metrics.targetClientWidth + 1,
      `${label} target overflows horizontally: ${metrics.targetScrollWidth}px > ${metrics.targetClientWidth}px.`,
    );
  }
}

async function assertVisibleFormFontSize(page, containerSelector, minimumPixels) {
  const sizes = await page
    .locator(
      `${containerSelector} input:not([type="hidden"]):not([type="range"]):not([type="checkbox"]):not([type="file"]), ${containerSelector} select, ${containerSelector} textarea`,
    )
    .evaluateAll((controls) =>
      controls
        .filter((control) => {
          const rect = control.getBoundingClientRect();
          const style = getComputedStyle(control);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden';
        })
        .map((control) => Number.parseFloat(getComputedStyle(control).fontSize)),
    );
  assert(sizes.length > 0, `No visible form controls found inside ${containerSelector}.`);
  assert(
    sizes.every((size) => size >= minimumPixels),
    `Visible form controls inside ${containerSelector} use font sizes below ${minimumPixels}px: ${sizes.join(', ')}.`,
  );
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
