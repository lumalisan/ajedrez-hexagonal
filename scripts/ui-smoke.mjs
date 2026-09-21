import { existsSync } from 'node:fs';

import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import {
  INITIAL_LAYOUT_LABELS,
  chooseSelectOption,
  openSelect,
  selectedOptionLabel,
  selectOptionLabels,
} from './select-helpers.mjs';

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
    { layout: '5', mode: 'local', viewport: { width: 1440, height: 900 } },
    { layout: '5', mode: 'machine', viewport: { width: 390, height: 844 } },
  ]) {
    const page = await browser.newPage({ viewport });
    watchErrors(page, runtimeErrors);
    await page.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
    await page.locator('[data-home-action="new"]').click();
    await page.locator(`[data-home-mode="${mode}"]`).click();
    if (mode === 'machine') {
      const difficulty = page.getByRole('combobox', { name: 'Dificultad', exact: true });
      await difficulty.waitFor({ state: 'visible' });
      assert((await difficulty.count()) === 1, 'AI must have a single difficulty selector.');
      assert(
        (await difficulty.getAttribute('aria-describedby'))
          ?.split(' ')
          .includes('ai-difficulty-description'),
        'The combobox must retain the description of AI difficulty for screen readers.',
      );
      assert(
        (await selectOptionLabels(page, 'Dificultad')).join('|') === 'Fácil|Media|Difícil|Experto',
        'AI must offer four clearly ordered difficulty levels.',
      );
      assert(
        (await page.locator('[data-ai-doctrine], .doctrine-grid').count()) === 0,
        'AI configuration must not expose a second doctrine selector.',
      );
      await chooseSelectOption(page, 'Dificultad', 'Experto');
      await openSelect(page, 'Dificultad');
      await difficulty.press('ArrowUp');
      assert(
        (await page
          .getByRole('option', { name: 'Experto', exact: true, selected: true })
          .count()) === 1,
        'Moving through difficulty options must not commit a choice before Enter.',
      );
      await difficulty.press('Escape');
      assert(
        (await difficulty.getAttribute('aria-expanded')) === 'false' &&
          (await page.locator('#game-dialog').isVisible()),
        'Escape must close the select menu while keeping its parent dialog open.',
      );
      assert(
        (await selectedOptionLabel(page, 'Dificultad')) === 'Experto',
        'Escape must preserve the previously selected difficulty.',
      );
      await openSelect(page, 'Dificultad');
      await difficulty.press('ArrowUp');
      await difficulty.press('Enter');
      assert(
        (await selectedOptionLabel(page, 'Dificultad')) === 'Difícil',
        'Difficulty must remain selectable with the keyboard.',
      );
      await openSelect(page, 'Dificultad');
      await assertSelectMenuWithinViewport(page, 'Difficulty menu');
      if (process.env.UI_SCREENSHOT)
        await page.screenshot({ path: `${process.env.UI_SCREENSHOT}-ai-mobile-select.png` });
      await difficulty.press('Escape');
      if (process.env.UI_SCREENSHOT)
        await page.screenshot({ path: `${process.env.UI_SCREENSHOT}-ai-mobile.png` });
      await difficulty.press('Escape');
      await page.locator('#game-dialog').waitFor({ state: 'hidden' });
      assert(
        await page
          .locator('[data-home-mode="machine"]')
          .evaluate((button) => button === document.activeElement),
        'Escape with the menu closed must close the dialog and return focus to its opener.',
      );
      await page.locator('[data-home-mode="machine"]').click();
      await chooseSelectOption(page, 'Dificultad', 'Difícil');
    }
    await page.locator('[data-preset="custom"]').click();
    const layoutSelect = page.getByRole('combobox', { name: 'Disposición inicial', exact: true });
    assert(
      (await selectOptionLabels(page, 'Disposición inicial')).join('|') ===
        'Frente clásico|Columnas de asedio|Frente blindado|Frente de infantería|Frente extendido',
      'All five initial layouts must be available, preserving the existing options.',
    );
    const preview = page.locator('[data-layout-preview]');
    await page.locator('[data-layout-preview][data-renderer-status="ready"]').waitFor();
    const previewImages = new Set();
    let previewSize;
    for (const [value, soldiers, tanks, capturers, launchers, airplanes] of [
      ['1', 5, 2, 1, 2, 2],
      ['2', 5, 2, 2, 1, 2],
      ['3', 5, 4, 1, 1, 1],
      ['4', 7, 2, 1, 1, 1],
      ['5', 11, 2, 1, 1, 1],
    ]) {
      await chooseSelectOption(page, 'Disposición inicial', INITIAL_LAYOUT_LABELS[value]);
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
          Object.values(roster).reduce((total, count) => total + count, 0) ===
            (value === '5' ? 22 : 18),
        `Layout ${value} must describe the actual army in text.`,
      );
      assert(
        (await page.locator('[data-layout-count]').textContent()) ===
          `${value === '5' ? 22 : 18} piezas por bando`,
        `Layout ${value} must announce its actual army size.`,
      );
      assert(
        await layoutSelect.evaluate((select) => select === document.activeElement),
        'Updating the preview must preserve keyboard focus.',
      );
    }
    assert(previewImages.size === 5, 'Each layout must produce a different board preview.');
    await openSelect(page, 'Disposición inicial');
    await layoutSelect.press('Home');
    await layoutSelect.press('ArrowDown');
    assert(
      (await preview.getAttribute('data-layout')) === '5',
      'Navigating layout options must leave the preview unchanged until selection is confirmed.',
    );
    await layoutSelect.press('Enter');
    assert(
      (await preview.getAttribute('data-layout')) === '2',
      'Keyboard selection must update the preview.',
    );
    await openSelect(page, 'Disposición inicial');
    await layoutSelect.press('End');
    await layoutSelect.press('Tab');
    assert(
      (await layoutSelect.getAttribute('aria-expanded')) === 'false' &&
        (await preview.getAttribute('data-layout')) === '2',
      'Tab must close the layout menu without committing the highlighted option.',
    );
    const beforeHealth = await preview.evaluate((canvas) => canvas.toDataURL());
    await chooseSelectOption(page, 'Puntos de vida de la Fortaleza', '3');
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert(
      (await preview.evaluate((canvas) => canvas.toDataURL())) !== beforeHealth,
      'Fortress health changes must be reflected in the preview.',
    );
    await chooseSelectOption(page, 'Puntos de vida de la Fortaleza', '2 · equilibrio recomendado');
    await page.locator('[data-preset="tactical"]').click();
    assert(await preview.isHidden(), 'The custom preview must hide when selecting another preset.');
    await page.locator('[data-preset="custom"]').click();
    await page.locator('[data-layout-preview][data-renderer-status="ready"]').waitFor();
    assert(
      (await preview.getAttribute('data-layout')) === '2',
      'Returning to custom must preserve the chosen layout.',
    );
    await chooseSelectOption(page, 'Disposición inicial', INITIAL_LAYOUT_LABELS[layout]);
    await page
      .locator('.layout-picker')
      .evaluate((picker) => picker.scrollIntoView({ block: 'start' }));
    await assertNoHorizontalOverflow(page, `Layout ${layout} configuration`, '#game-dialog');
    if (process.env.UI_SCREENSHOT)
      await page.screenshot({
        path: `${process.env.UI_SCREENSHOT}-layout-${layout}-${mode}-config.png`,
      });
    await page.locator('[data-start-free]').click();
    await page.locator('#game-dialog').waitFor({ state: 'hidden' });
    if (mode === 'machine') {
      const rival = await page.evaluate(
        () => JSON.parse(localStorage.getItem('atlas-match-classic-v2')).config.participants[1],
      );
      assert(
        rival.difficulty === 'commander' && rival.personality === 'balanced',
        'A new AI match must save the selected difficulty with the default strategy.',
      );
    }
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
    if (layout === '5') {
      for (const [q, r, label] of [
        [5, -5, 'SOL,'],
        [1, -3, 'SOL,'],
        [2, -4, 'TNQ,'],
        [-5, 0, 'SOL,'],
        [-1, -2, 'SOL,'],
        [-2, -2, 'TNQ,'],
      ]) {
        for (const sign of [1, -1]) {
          assert(
            (
              await page.locator(`#sr-board [data-hex="${q * sign},${r * sign}"]`).textContent()
            )?.startsWith(label),
            `Extended layout must place ${label} at ${q * sign},${r * sign}.`,
          );
        }
      }
    }
    await assertNoHorizontalOverflow(page, `Layout ${layout} match`);
    if (process.env.UI_SCREENSHOT)
      await page.screenshot({
        path: `${process.env.UI_SCREENSHOT}-layout-${layout}-${mode}-board.png`,
      });
    await page.close();
  }

  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(desktop, runtimeErrors);
  await desktop.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  assert(
    await desktop.locator('#home-screen').isVisible(),
    'The new home screen must be visible on first load.',
  );
  await assertFullscreenAvailable(desktop, 'Home');
  assert(
    (await desktop.locator('[data-home-action]').count()) >= 5 &&
      (await desktop.locator('[data-home-action="laboratory"]').count()) === 0,
    'Home must retain New game, Continue, Rules, Tutorial and History without Laboratory.',
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

  await assertAchievementsCatalog(desktop, 'Desktop');

  await desktop.locator('[data-home-action="rules"]').click();
  await desktop.locator('#rules-article').waitFor({ state: 'visible' });
  await assertFullscreenAvailable(desktop, 'Rules');
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

  await assertRulesLayouts(desktop, 'desktop');

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
    (await selectedOptionLabel(desktop, 'Puntos de vida de la Fortaleza')) ===
      '2 · equilibrio recomendado',
    'Fortress health must default to the balanced 2 HP.',
  );
  assert(
    (await selectedOptionLabel(desktop, 'Disposición inicial')) === 'Frente clásico',
    'Initial layout must default to option 1.',
  );
  await chooseSelectOption(desktop, 'Disposición inicial', 'Columnas de asedio');
  await desktop.locator('[data-start-free]').click();
  await desktop.locator('#game-dialog').waitFor({ state: 'hidden' });
  assert(
    await desktop.evaluate(() => !document.documentElement.classList.contains('modal-open')),
    'Closing a modal must restore the page scroll state.',
  );
  assert((await desktop.title()) === 'Protocolo Hexagonal', 'Document title missing.');
  await assertFullscreenAvailable(desktop, 'Match');
  assert(
    (await desktop.locator('#threat-toggle').count()) === 0 &&
      (await desktop.locator('#command-panel').isHidden()) &&
      (await desktop.locator('#battle-log-panel').isHidden()),
    'A new match must hide the command and battle log panels and remove the threat control.',
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
  await desktop.locator('[data-volume="masterVolume"]').waitFor({ state: 'visible' });
  assert(
    (await desktop.locator('[data-volume]').count()) === 3,
    'Options must expose three volume sliders.',
  );
  assert(
    (await desktop.locator('.accessibility-settings .toggle-row').count()) >= 2,
    'Accessibility options missing.',
  );
  const fixedBoardToggle = desktop.locator('[data-pref="fixed-board"]');
  assert(
    (await desktop
      .locator(
        '[data-pref="board-depth"], [data-pref="hints"], [data-pref="threats"], [data-data-center]',
      )
      .count()) === 0,
    'Settings must remove perspective, contextual hints, threats and the nested data menu.',
  );
  for (const label of [
    'Exportar partida',
    'Importar partida',
    'Ver repetición',
    'Historial de resultados',
  ]) {
    assert(
      await desktop.getByRole('button', { name: label, exact: true }).isVisible(),
      `${label} must be directly available in settings.`,
    );
  }
  assert(
    (await desktop.locator('#game-canvas').getAttribute('data-perspective')) === '2d',
    'The board must remain flat.',
  );
  assert((await fixedBoardToggle.count()) === 1, 'Fixed-board option missing.');
  assert(await fixedBoardToggle.isChecked(), 'Fixed-board option must be enabled by default.');
  await fixedBoardToggle.uncheck();
  await fixedBoardToggle.check();
  assert(
    await desktop.evaluate(
      () => JSON.parse(localStorage.getItem('atlas-preferences-v2') ?? '{}').fixedBoard === true,
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
  await desktop.locator('#rules-article').waitFor();
  await assertFullscreenAvailable(desktop, 'Match rules');
  const matchBeforeRulesPreview = await desktop.evaluate(() =>
    localStorage.getItem('atlas-match-classic-v2'),
  );
  await desktop.locator('[data-rule-section="desarrollo"]').click();
  await chooseSelectOption(desktop, 'Disposición inicial', 'Frente extendido');
  await desktop
    .locator('[data-rules-layout-preview][data-layout="5"][data-renderer-status="ready"]')
    .waitFor();
  assert(
    (await desktop.evaluate(() => localStorage.getItem('atlas-match-classic-v2'))) ===
      matchBeforeRulesPreview,
    'Exploring rule layouts must preserve the active match, its history and configuration.',
  );
  await desktop.locator('.rules-close').click();

  await clickHex(desktop, 0, -2);
  await desktop.locator('#piece-card h2').waitFor({ state: 'visible' });
  assert(
    (await desktop.locator('#piece-card h2').textContent())?.includes('Soldado'),
    'Canvas selection failed.',
  );
  assert(
    (await desktop.locator('#command-panel').isVisible()) &&
      (await desktop.locator('#selection-summary').textContent()) ===
        'Soldado seleccionado. Elige una casilla para desplazarte o atacar, o cambia su orientación.',
    'Selecting a soldier must reveal the command panel and its next-step instruction.',
  );
  await desktop.locator('#log-toggle').click();
  assert(
    (await desktop.locator('#command-panel').isHidden()) &&
      (await desktop.locator('#battle-log-panel').isVisible()),
    'Opening the battle log must deselect the unit and replace its command panel.',
  );
  await clickHex(desktop, 0, -2);
  assert(
    (await desktop.locator('#command-panel').isVisible()) &&
      (await desktop.locator('#battle-log-panel').isHidden()),
    'Selecting a unit must replace the battle log with its command panel.',
  );
  assert(
    await desktop.locator('#cancel-selection').isHidden(),
    'Cancel must appear beside confirmation only when an order is prepared.',
  );
  await clickHex(desktop, 0, -1);
  await assertPendingActionsTogether(desktop);
  if (process.env.UI_SCREENSHOT)
    await desktop.screenshot({ path: `${process.env.UI_SCREENSHOT}-cancel-desktop.png` });
  await desktop.locator('#cancel-selection').click();
  assert(
    (await desktop.locator('#command-panel').isVisible()) &&
      (await desktop.locator('#pending-card').isHidden()) &&
      (await desktop.locator('#battle-log li:not(.empty-log)').count()) === 0 &&
      (await desktop.locator('#selection-summary').textContent()) ===
        'Soldado seleccionado. Elige una casilla para desplazarte o atacar, o cambia su orientación.',
    'Cancel must discard the prepared order while keeping its unit and panel selected.',
  );
  assert(
    await desktop
      .locator('#command-panel')
      .evaluate((panel) => panel.contains(document.activeElement)),
    'Cancelling an order from its button must keep keyboard focus in the command panel.',
  );
  await clickHex(desktop, 0, -2);
  assert(
    await desktop.locator('#command-panel').isVisible(),
    'Clicking the selected piece must keep its command panel open.',
  );
  await clickHex(desktop, 0, 0);
  assert(
    await desktop.locator('#command-panel').isVisible(),
    'Clicking an empty cell without a legal order must keep the command panel open.',
  );
  await clickHex(desktop, 0, -1);
  await desktop.locator('#game-canvas').focus();
  await desktop.keyboard.press('Escape');
  await desktop.keyboard.press('Escape');
  assert(
    (await desktop.locator('#command-panel').isVisible()) &&
      (await desktop.locator('#pending-card').isHidden()),
    'Escape from the board must cancel a draft and preserve the panel on repeated presses.',
  );
  await clickHex(desktop, 0, -1);
  await desktop.locator('#pending-card .confirm-button').focus();
  await desktop.keyboard.press('Escape');
  await desktop.keyboard.press('Escape');
  assert(
    (await desktop.locator('#command-panel').isVisible()) &&
      (await desktop.locator('#pending-card').isHidden()),
    'Escape from panel controls must cancel a draft and preserve the panel on repeated presses.',
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
  assert(
    (await desktop.locator('#action-controls h3').textContent()) === 'Cambiar orientación' &&
      (await desktop.locator('#selection-summary').textContent()) ===
        'Elige un rumbo en la brújula del panel de mando',
    'Soldier orientation must use the requested label and compass instruction.',
  );
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
    (await desktop.locator('#selection-summary').textContent()) ===
      'Confirma la acción en el panel de mando',
    'Choosing a direction must ask for confirmation.',
  );
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

  const windowPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(windowPage, runtimeErrors);
  await windowPage.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await selectMode(windowPage, 'local');
  const unobstructedCanvas = await windowPage.locator('#game-canvas').boundingBox();
  await clickHex(windowPage, 0, -2);
  const defaultWindow = await windowPage.locator('#command-panel').boundingBox();
  assert(defaultWindow, 'The floating command window must appear after selection.');
  await assertCanvasBounds(windowPage, unobstructedCanvas, 'Selecting a unit');
  await clickHex(windowPage, 0, -1);
  await windowPage.locator('#pending-card .confirm-button').waitFor();
  await assertCanvasBounds(windowPage, unobstructedCanvas, 'Preparing an order');
  const beforeDrag = await windowPage.locator('#command-panel').boundingBox();
  await dragCommandWindow(windowPage, -160, 35);
  const afterDrag = await windowPage.locator('#command-panel').boundingBox();
  assert(
    afterDrag.x < beforeDrag.x - 100 && afterDrag.y > beforeDrag.y + 20,
    'Dragging the command titlebar must move the window independently of the board.',
  );
  await assertCanvasBounds(windowPage, unobstructedCanvas, 'Dragging the command window');
  const titlebar = windowPage.locator('#command-window-titlebar');
  await titlebar.focus();
  await titlebar.press('ArrowLeft');
  const afterArrow = await windowPage.locator('#command-panel').boundingBox();
  assert(
    afterArrow.x < afterDrag.x && Math.abs(afterArrow.y - afterDrag.y) <= 1,
    'A focused titlebar must support horizontal movement with arrow keys.',
  );
  await titlebar.press('Shift+ArrowDown');
  const beforeMinimize = await windowPage.locator('#command-panel').boundingBox();
  assert(
    beforeMinimize.y - afterArrow.y > afterDrag.x - afterArrow.x,
    'Shift and an arrow must move the command window farther than a plain arrow.',
  );
  await windowPage.locator('#minimize-command-panel').click();
  assert(
    (await windowPage.locator('#command-panel').isHidden()) &&
      (await windowPage.locator('#command-panel-restore').isVisible()),
    'Minimizing must replace the floating window with a restore control.',
  );
  await assertCanvasBounds(windowPage, unobstructedCanvas, 'Minimizing the command window');
  await windowPage.locator('#command-panel-restore').click();
  const restoredWindow = await windowPage.locator('#command-panel').boundingBox();
  assert(
    Math.abs(restoredWindow.x - beforeMinimize.x) <= 1 &&
      Math.abs(restoredWindow.y - beforeMinimize.y) <= 1 &&
      (await windowPage.locator('#pending-card .confirm-button').isVisible()) &&
      (await windowPage.locator('#battle-log li:not(.empty-log)').count()) === 0,
    'Restoring must preserve the dragged position and the unexecuted prepared order.',
  );
  await assertCanvasBounds(windowPage, unobstructedCanvas, 'Restoring the command window');
  await windowPage.locator('#minimize-command-panel').click();
  await clickHex(windowPage, 2, -3);
  const restoredBySelection = await windowPage.locator('#command-panel').boundingBox();
  assert(
    restoredBySelection &&
      Math.abs(restoredBySelection.x - beforeMinimize.x) <= 1 &&
      Math.abs(restoredBySelection.y - beforeMinimize.y) <= 1 &&
      (await windowPage.locator('#pending-card').isHidden()),
    'Selecting another unit must restore the minimized window at its previous position.',
  );
  await windowPage.locator('#close-command-panel').click();
  assert(
    (await windowPage.locator('#command-panel').isHidden()) &&
      (await windowPage.locator('#command-panel-restore').isHidden()) &&
      (await windowPage.locator('#selection-summary').textContent()) ===
        'Turno de Cian. Selecciona una unidad propia.',
    'Closing the window must deselect the unit and discard its prepared order.',
  );
  await assertCanvasBounds(windowPage, unobstructedCanvas, 'Closing the command window');
  await clickHex(windowPage, 0, -2);
  const reopenedWindow = await windowPage.locator('#command-panel').boundingBox();
  assert(
    Math.abs(reopenedWindow.x - defaultWindow.x) <= 1 &&
      Math.abs(reopenedWindow.y - defaultWindow.y) <= 1 &&
      (await windowPage.locator('#pending-card').isHidden()),
    'The next selection after closing must reset the window to its default position.',
  );
  await dragCommandWindow(windowPage, -120, 40);
  await clickHex(windowPage, 0, -1);
  const beforeCancel = await windowPage.locator('#command-panel').boundingBox();
  await windowPage.locator('#cancel-selection').click();
  const afterCancel = await windowPage.locator('#command-panel').boundingBox();
  assert(
    afterCancel &&
      Math.abs(afterCancel.x - beforeCancel.x) <= 1 &&
      Math.abs(afterCancel.y - beforeCancel.y) <= 1 &&
      (await windowPage.locator('#pending-card').isHidden()),
    'Cancelling a prepared order must keep the command window open at its chosen position.',
  );
  await dragCommandWindow(windowPage, 1_200, 800);
  await assertCommandWindowInsideArena(windowPage, 'Dragging toward the edge');
  await windowPage.setViewportSize({ width: 1000, height: 700 });
  await assertCommandWindowInsideArena(windowPage, 'Resizing the desktop');
  await windowPage.close();

  const cannonPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(cannonPage, runtimeErrors);
  await cannonPage.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await selectMode(cannonPage, 'local');
  await cannonPage.locator('#settings-button').click();
  assert(
    (await selectOptionLabels(cannonPage, 'Confirmación de órdenes')).join('|') ===
      'Siempre|Solo críticas|Rápida',
    'Order confirmation must preserve the three existing choices.',
  );
  await chooseSelectOption(cannonPage, 'Confirmación de órdenes', 'Rápida');
  assert(
    await cannonPage.evaluate(
      () =>
        JSON.parse(localStorage.getItem('atlas-preferences-v2') ?? '{}').confirmation === 'quick',
    ),
    'Changing the confirmation combobox must persist the actual preference.',
  );
  await cannonPage.locator('[data-dialog-close]').click();
  await cannonPage.reload({ waitUntil: 'networkidle' });
  await cannonPage.locator('[data-home-action="continue"]').click();
  await cannonPage.locator('#settings-button').click();
  assert(
    (await selectedOptionLabel(cannonPage, 'Confirmación de órdenes')) === 'Rápida',
    'Order confirmation must recover its selected value after reloading the application.',
  );
  await cannonPage.locator('[data-dialog-close]').click();
  await clickHex(cannonPage, 1, -3);
  assert(
    (await cannonPage.locator('#piece-card h2').textContent())?.includes('Tanque'),
    'Tank selection failed.',
  );
  await cannonPage.locator('[data-command="transform"]').click();
  assert(
    (await cannonPage.locator('#selection-summary').textContent()) ===
      'Elige un rumbo en la brújula del panel de mando',
    'Abandoning a vehicle must begin by asking for its soldier orientation.',
  );
  await cannonPage.locator('[data-transform-facing="3"]').click();
  assert(
    (await cannonPage.locator('.transform-warning').textContent()) ===
      'Para realizar un desplazamiento o ataque como soldado en este mismo turno, selecciona la casilla de destino antes de confirmar' &&
      (await cannonPage.locator('.consequence-lens').count()) === 0,
    'A stationary transformation must show the destination reminder without the consequence card.',
  );
  const transformedMove = cannonPage
    .locator('#sr-board [role="gridcell"]')
    .filter({ hasText: 'el Soldado avanzará' })
    .first();
  const transformedKey = await transformedMove.getAttribute('data-hex');
  assert(transformedKey, 'The selected tank must offer a soldier destination.');
  const [soldierQ, soldierR] = transformedKey.split(',').map(Number);
  await clickHex(cannonPage, soldierQ, soldierR);
  assert(
    (await cannonPage.locator('.transform-warning').count()) === 0 &&
      (await cannonPage.locator('#selection-summary').textContent()) ===
        'Confirma la acción en el panel de mando',
    'Selecting the transformed soldier destination must remove the reminder and ask for confirmation.',
  );
  await cannonPage.locator('#cancel-selection').click();
  assert(
    (await cannonPage.locator('#command-panel').isVisible()) &&
      (await cannonPage.locator('#pending-card').isHidden()) &&
      (await cannonPage.locator('[data-command="transform"]').isVisible()),
    'Cancelling transformation must retain the tank and restore its normal orders.',
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
    (await cannonPage.locator('.hex-compass.compact .compass-direction').count()) === 6 &&
      (await cannonPage.locator('#battle-log li:not(.empty-log)').count()) === 0 &&
      (await cannonPage.locator('#pending-card .confirm-button').isVisible()),
    'Quick tank movement must wait for cannon orientation and confirmation before executing.',
  );
  const alternateCannon = cannonPage.locator('[data-pending-cannon]:not(.active)').first();
  const chosenCannon = Number(await alternateCannon.getAttribute('data-pending-cannon'));
  await alternateCannon.click();
  assert(
    (await cannonPage.locator('#battle-log li:not(.empty-log)').count()) === 0,
    'Selecting the tank cannon orientation must keep the move pending.',
  );
  if (process.env.UI_SCREENSHOT)
    await cannonPage.screenshot({ path: `${process.env.UI_SCREENSHOT}-compact-compass.png` });
  await cannonPage.locator('#pending-card .confirm-button').click();
  await assertActionHistory(cannonPage, 1, 1);
  assert(
    await cannonPage.evaluate(
      (direction) =>
        JSON.parse(localStorage.getItem('atlas-match-classic-v2')).actions[0].cannon === direction,
      chosenCannon,
    ),
    'Confirmed tank movement must save the chosen cannon orientation.',
  );
  await cannonPage.close();

  const instantAchievement = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watchErrors(instantAchievement, runtimeErrors);
  await instantAchievement.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await selectMode(instantAchievement, 'local');
  await clickHex(instantAchievement, 1, -3);
  await instantAchievement.locator('[data-command="transform"]').click();
  await instantAchievement.locator('[data-transform-facing="3"]').click();
  assert(
    (await instantAchievement
      .locator('[data-achievement-notification="transformation"]')
      .count()) === 0,
    'Preparing a transformation must not unlock its achievement before confirming the order.',
  );
  await instantAchievement.locator('#pending-card .confirm-button').click();
  const instantNotice = instantAchievement.locator(
    '[data-achievement-notification="transformation"]',
  );
  await instantNotice.waitFor({ state: 'visible' });
  assert(
    (await instantNotice.locator('img.achievement-icon').count()) === 1 &&
      (await instantNotice.locator('strong').textContent()) === 'Me bajo aquí' &&
      (await instantNotice.locator('p, button, progress').count()) === 0,
    'A confirmed transformation must immediately show only its achievement icon and title.',
  );
  const liveAchievement = await instantAchievement.evaluate(() => {
    const record = JSON.parse(localStorage.getItem('atlas-match-classic-v2'));
    const progress = JSON.parse(localStorage.getItem('atlas-achievements-v1'));
    const history = JSON.parse(localStorage.getItem('atlas-match-history-v1') ?? '[]');
    return {
      active: record?.currentAction === 1 && !record.conclusion && history.length === 0,
      transformations: progress?.counters.transformations,
      unlockedAt: progress?.unlockedAt.transformation,
    };
  });
  assert(
    liveAchievement.active &&
      liveAchievement.transformations === 1 &&
      Boolean(liveAchievement.unlockedAt),
    'The tactical unlock and counter must persist while its match is still active and unfinished.',
  );
  await instantAchievement.reload({ waitUntil: 'networkidle' });
  await instantAchievement.locator('[data-home-action="achievements"]').click();
  const savedTransformation = instantAchievement.locator('[data-achievement-id="transformation"]');
  assert(
    (await savedTransformation.locator('.achievement-state').textContent())?.includes(
      'Desbloqueado',
    ) &&
      (await savedTransformation.locator('time').getAttribute('datetime')) ===
        liveAchievement.unlockedAt,
    'An instant achievement must remain unlocked after reloading without completing its match.',
  );
  await instantAchievement.getByRole('button', { name: 'Cerrar logros', exact: true }).click();
  await instantAchievement.locator('[data-home-action="continue"]').click();
  await assertActionHistory(instantAchievement, 1, 1);
  await instantAchievement.locator('#undo-action').click();
  await assertActionHistory(instantAchievement, 0, 1);
  await instantAchievement.locator('#redo-action').click();
  await assertActionHistory(instantAchievement, 1, 1);
  assert(
    await instantAchievement.evaluate(
      () =>
        JSON.parse(localStorage.getItem('atlas-achievements-v1')).counters.transformations === 1,
    ),
    'Resuming and redoing an order must not count an instant achievement action twice.',
  );
  await instantAchievement.close();

  for (const [control, confirmation] of [
    ['#new-game-button', '[data-confirm-abandon]'],
    ['#resign-button', '[data-confirm-resign]'],
    ['#blockade-button', '[data-confirm-draw-offer]'],
  ]) {
    const confirmationPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watchErrors(confirmationPage, runtimeErrors);
    await confirmationPage.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
    await selectMode(confirmationPage, 'local');
    await confirmationPage.locator(control).click();
    await confirmationPage.locator(confirmation).waitFor({ state: 'visible' });
    assert(
      await confirmationPage.locator(confirmation).isVisible(),
      `${control} must ask for confirmation.`,
    );
    assert(
      await confirmationPage.evaluate(
        () => JSON.parse(localStorage.getItem('atlas-match-classic-v2'))?.outcome == null,
      ),
      'Opening a confirmation must not conclude the match.',
    );
    await confirmationPage.locator('[data-dialog-close]').click();
    assert(
      await confirmationPage.locator('#home-screen').isHidden(),
      'Cancelling must keep the match visible.',
    );
    await confirmationPage.locator(control).click();
    await confirmationPage.locator(confirmation).click();
    if (control === '#new-game-button') {
      await confirmationPage.locator('#home-screen').waitFor();
      assert(
        (await confirmationPage.locator('#game-dialog').isHidden()) &&
          (await confirmationPage.locator('[data-home-action="new"]').isVisible()),
        'Abandoning must return directly to the main home menu.',
      );
    } else if (control === '#blockade-button') {
      await confirmationPage.locator('[data-accept-blockade]').waitFor();
      assert(
        await confirmationPage.getByRole('button', { name: 'Rechazar', exact: true }).isVisible(),
        'A confirmed draw offer must still give the opponent the choice to reject it.',
      );
      await confirmationPage.locator('[data-accept-blockade]').click();
      await confirmationPage.waitForFunction(
        () => localStorage.getItem('atlas-match-classic-v2') === null,
      );
    } else {
      await confirmationPage.waitForFunction(() => {
        const history = JSON.parse(localStorage.getItem('atlas-match-history-v1') ?? '[]');
        return (
          localStorage.getItem('atlas-match-classic-v2') === null &&
          history[0]?.outcome?.reason === 'resignation'
        );
      });
    }
    await confirmationPage.close();
  }

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
  await assertAchievementsCatalog(mobile, 'Mobile');
  await mobile.locator('[data-home-action="rules"]').click();
  await assertRulesLayouts(mobile, 'mobile');
  await mobile.locator('.rules-close').click();
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
    await mobile.locator('#new-game-button').isVisible(),
    'Mobile abandon-match control is hidden.',
  );
  await assertTopActionsDoNotOverlap(mobile);
  await assertBoardHistoryControlsFit(mobile);
  assert(
    await mobile.locator('#command-panel').isHidden(),
    'The command panel must stay hidden before a mobile selection.',
  );
  assert(
    (await mobile.locator('.legend > span:visible').count()) === 5,
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
    (await mobile.locator('#cancel-selection').isHidden()) &&
      (await mobile.locator('#close-command-panel').isVisible()),
    'A mobile selection must expose the close button and reserve Cancel for prepared orders.',
  );
  assert(
    (await mobile.locator('#minimize-command-panel').isHidden()) &&
      (await mobile.locator('#command-panel-restore').isHidden()),
    'Mobile must retain the inline command panel without desktop minimize controls.',
  );
  await mobile.keyboard.press('w');
  assert((await selectedHex(mobile)) === '0,-1', 'W must move focus onto the soldier destination.');
  await mobile.keyboard.press('Enter');
  await mobile.locator('#pending-card:not([hidden])').waitFor();
  await assertPendingActionsTogether(mobile);
  await mobile.locator('#pending-card .confirm-button').scrollIntoViewIfNeeded();
  if (process.env.UI_SCREENSHOT)
    await mobile.screenshot({ path: `${process.env.UI_SCREENSHOT}-cancel-mobile.png` });
  await mobile.locator('#cancel-selection').click();
  assert(
    (await mobile.locator('#command-panel').isVisible()) &&
      (await mobile.locator('#pending-card').isHidden()),
    'Cancel on a portrait phone must preserve the selected unit and command panel.',
  );
  await mobile.locator('#game-canvas').focus();
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
  assert(await narrow.locator('#command-panel').isHidden(), 'No unit means no command panel.');
  await clickHex(narrow, 0, -2);
  await narrow.locator('#command-panel').waitFor();
  await assertNoHorizontalOverflow(narrow, 'Narrow selected unit');
  assert(
    await narrow.locator('#close-command-panel').isVisible(),
    'Selecting a unit must expose a reachable close button on small phones.',
  );
  await clickHex(narrow, 0, -1);
  await narrow.locator('#pending-card .confirm-button').scrollIntoViewIfNeeded();
  await assertNoHorizontalOverflow(narrow, 'Narrow pending order');
  await assertPendingActionsTogether(narrow);
  assert(
    await narrow.locator('#pending-card .confirm-button').isVisible(),
    'Prepared orders must expose confirmation on mobile.',
  );
  if (process.env.UI_SCREENSHOT)
    await narrow.screenshot({ path: `${process.env.UI_SCREENSHOT}-mobile-pending.png` });
  await narrow.locator('#cancel-selection').click();
  assert(
    (await narrow.locator('#command-panel').isVisible()) &&
      (await narrow.locator('#pending-card').isHidden()) &&
      (await narrow.locator('#battle-log li:not(.empty-log)').count()) === 0,
    'Cancelling a prepared order must preserve the mobile panel without executing the order.',
  );
  await narrow.locator('#close-command-panel').click();
  assert(
    (await narrow.locator('#command-panel').isHidden()) &&
      (await narrow.locator('#command-panel-restore').isHidden()),
    'The mobile close button must close the panel and deselect its unit.',
  );
  await narrow.locator('#log-toggle').click();
  assert(await narrow.locator('#battle-log-panel').isVisible(), 'Battle log must open on mobile.');
  await narrow.locator('#close-battle-log').click();
  assert(await narrow.locator('#battle-log-panel').isHidden(), 'Battle log must close on mobile.');
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
  for (const viewport of [
    { width: 568, height: 320 },
    { width: 844, height: 390 },
  ]) {
    await compactLandscape.setViewportSize(viewport);
    await compactLandscape.locator('[data-home-action="achievements"]').click();
    const entries = compactLandscape.locator('[data-achievement-id]');
    await entries.first().waitFor();
    for (const entry of [entries.first(), entries.last()]) {
      await entry.scrollIntoViewIfNeeded();
      assert(
        await entry.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const dialog = element.closest('dialog').getBoundingClientRect();
          const list = element.closest('.achievements-list').getBoundingClientRect();
          return list.height > 0 && bounds.top >= dialog.top && bounds.bottom <= dialog.bottom;
        }),
        'Short landscape achievements must allow scrolling to every complete row.',
      );
    }
    await assertNoHorizontalOverflow(compactLandscape, 'Landscape achievements', '#game-dialog');
    await compactLandscape.keyboard.press('Escape');
  }
  await compactLandscape.setViewportSize({ width: 568, height: 320 });
  await selectMode(compactLandscape, 'local');
  await assertNoHorizontalOverflow(compactLandscape, 'Compact landscape match');
  await assertBoardHistoryControlsFit(compactLandscape);
  assert(
    await compactLandscape.locator('#command-panel').isHidden(),
    'Landscape match must start with the command panel hidden.',
  );
  assert(
    (await compactLandscape.locator('#game-canvas').boundingBox()).height >= 180,
    'Compact landscape must preserve a useful board before selection.',
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
  await compactLandscape.locator('[data-open-replay]').click();
  await compactLandscape.locator('.replay-dock').waitFor();
  assert(
    (await compactLandscape.getByRole('button', { name: 'Explorar desde aquí' }).count()) === 0 &&
      (await compactLandscape.locator('.replay-dock [data-export-match]').textContent()) ===
        'Exportar partida',
    'Replay must expose the renamed export action and no branching action.',
  );
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
  assert(
    (await selectOptionLabels(clocked, 'Tiempo')).join('|') ===
      'Sin límite|5 minutos|10 minutos|20 minutos',
    'The clock combobox must preserve all time controls.',
  );
  await chooseSelectOption(clocked, 'Tiempo', '10 minutos');
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
  await clocked.waitForFunction(
    (remainingBeforeHandoff) => {
      const clock = JSON.parse(localStorage.getItem('atlas-match-classic-v2')).clock;
      return (
        clock.status === 'running' &&
        clock.activePlayer === 1 &&
        clock.remainingMs[1] < remainingBeforeHandoff
      );
    },
    pausedClock.remainingMs[1],
    { timeout: 5_000 },
  );
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
  const achievementNotice = academy.locator('[data-achievement-notification="academy-first"]');
  await achievementNotice.waitFor({ state: 'visible' });
  assert(
    (await achievementNotice.locator('.achievement-icon').count()) === 1 &&
      (await achievementNotice.locator('strong').textContent()) === 'Yo he venido a aprender' &&
      (await achievementNotice.locator('p, button, progress').count()) === 0,
    'Completing a lesson must show an achievement notification with only its icon and title.',
  );
  assert(
    await achievementNotice.evaluate((notice) => {
      const liveRegion = notice.closest('[role="status"]');
      return (
        liveRegion?.getAttribute('aria-live') === 'polite' &&
        !notice.contains(document.activeElement)
      );
    }),
    'Achievement notifications must announce the unlock without taking keyboard focus.',
  );
  if (process.env.UI_SCREENSHOT)
    await academy.screenshot({ path: `${process.env.UI_SCREENSHOT}-achievement-notification.png` });
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
    await academy.locator('[data-home-action="continue"]').isDisabled(),
    'A completed Academy mission must not remain as an active saved match.',
  );
  assert(
    await academy
      .locator('[data-home-action="history"]')
      .evaluate((element) => getComputedStyle(element).cursor === 'pointer'),
    'Completed matches must remain available through History.',
  );
  await academy.locator('[data-home-action="achievements"]').click();
  await academy.getByRole('heading', { name: 'Logros', exact: true }).waitFor();
  const completedLesson = academy.locator('[data-achievement-id="academy-first"]');
  assert(
    (await completedLesson.locator('.achievement-state').textContent())?.includes('Desbloqueado') &&
      Boolean(await completedLesson.locator('time').getAttribute('datetime')),
    'The completed lesson achievement and its unlock date must survive reloading.',
  );
  const tutorialProgress = academy
    .locator('[data-achievement-id="tutorial-complete"]')
    .getByRole('progressbar');
  assert(
    (await tutorialProgress.getAttribute('value')) === '1' &&
      Number(await tutorialProgress.getAttribute('max')) > 1,
    'The tutorial achievement must retain partial progress after completing the first lesson.',
  );
  await academy.getByRole('button', { name: /^Desbloqueados/ }).click();
  assert(
    await completedLesson.isVisible(),
    'The unlocked filter must include an achievement earned through real gameplay.',
  );
  await academy.getByRole('button', { name: /^Pendientes/ }).click();
  assert(
    (await completedLesson.count()) === 0 && (await tutorialProgress.count()) === 1,
    'The pending filter must exclude earned achievements while retaining partial progress.',
  );
  await academy.getByRole('button', { name: 'Cerrar logros', exact: true }).click();
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
  await solo.close();

  assert(runtimeErrors.length === 0, `Browser runtime errors:\n${runtimeErrors.join('\n')}`);
  console.log(
    'UI smoke passed: desktop and mobile achievements and live rules layouts, earned notification and saved progress, desktop flow, local undo/redo and saved history, 320px portrait utilities, 568px landscape replay, mobile keyboard navigation.',
  );
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
  if (mode === 'machine') {
    await chooseSelectOption(page, 'Dificultad', 'Experto');
    if (process.env.UI_SCREENSHOT)
      await page.screenshot({ path: `${process.env.UI_SCREENSHOT}-ai-desktop.png` });
  }
  await page.locator('[data-start-free]').click();
  await page.locator('#game-dialog').waitFor({ state: 'hidden' });
  await page.locator('#game-canvas[data-renderer-status="ready"]').waitFor();
}

async function doubleClickHex(page, q, r) {
  const point = await pointForHex(page, q, r);
  await page.mouse.dblclick(point.x, point.y);
}

async function pointForHex(page, q, r) {
  const canvas = page.locator('#game-canvas');
  await canvas.scrollIntoViewIfNeeded();
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

async function assertCanvasBounds(page, expected, action) {
  const current = await page.locator('#game-canvas').boundingBox();
  assert(
    expected &&
      current &&
      ['x', 'y', 'width', 'height'].every((key) => Math.abs(current[key] - expected[key]) <= 1),
    `${action} must not move or resize the desktop board: ${JSON.stringify({ expected, current })}.`,
  );
}

async function dragCommandWindow(page, deltaX, deltaY) {
  const titlebar = page.locator('#command-window-titlebar');
  const box = await titlebar.boundingBox();
  assert(box, 'The command window titlebar must be visible for dragging.');
  const viewport = page.viewportSize();
  const x = box.x + 24;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(
    Math.max(1, Math.min(viewport.width - 2, x + deltaX)),
    Math.max(1, Math.min(viewport.height - 2, y + deltaY)),
    { steps: 8 },
  );
  await page.mouse.up();
}

async function assertCommandWindowInsideArena(page, action) {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const arena = await page.locator('#board-arena').boundingBox();
  const panel = await page.locator('#command-panel').boundingBox();
  assert(
    arena &&
      panel &&
      panel.x >= arena.x - 1 &&
      panel.y >= arena.y - 1 &&
      panel.x + panel.width <= arena.x + arena.width + 1 &&
      panel.y + panel.height <= arena.y + arena.height + 1,
    `${action} must keep the floating command window inside the arena: ${JSON.stringify({ arena, panel })}.`,
  );
}

async function assertTopActionsDoNotOverlap(page) {
  const boxes = await page.locator('.top-actions .icon-button').evaluateAll((buttons) =>
    buttons
      .filter((button) => button.getBoundingClientRect().width > 0)
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }),
  );
  assert(
    boxes.length === 6,
    'Mobile header must expose sound, achievements, settings, help, resign and draw controls.',
  );
  for (let index = 0; index < boxes.length; index += 1) {
    for (const other of boxes.slice(index + 1)) {
      const button = boxes[index];
      assert(
        button.right <= other.left ||
          other.right <= button.left ||
          button.bottom <= other.top ||
          other.bottom <= button.top,
        'Mobile header icon controls overlap.',
      );
    }
  }
}

async function assertPendingActionsReachable(page) {
  await page.locator('#pending-card .confirm-button').waitFor();
  await assertPendingActionsTogether(page);
  const controls = [];
  const buttons = await page.locator('#pending-card .confirm-button, #cancel-selection').all();
  for (const button of buttons) {
    await button.scrollIntoViewIfNeeded();
    controls.push(
      await button.evaluate((button) => {
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
  }
  assert(
    controls.length === 2 &&
      controls.every(({ visible, width, height }) => visible && width >= 44 && height >= 44),
    `Landscape confirmation controls must remain visible and touch accessible: ${JSON.stringify(controls)}.`,
  );
}

async function assertPendingActionsTogether(page) {
  const confirm = await page
    .locator('#pending-card .pending-actions .confirm-button')
    .boundingBox();
  const cancel = await page
    .locator('#pending-card .pending-actions #cancel-selection')
    .boundingBox();
  assert(
    confirm &&
      cancel &&
      Math.abs(confirm.y - cancel.y) <= 1 &&
      (confirm.x + confirm.width <= cancel.x + 1 || cancel.x + cancel.width <= confirm.x + 1) &&
      cancel.width >= 44 &&
      cancel.height >= 44,
    'Cancel must remain beside Confirm action in the same row with a touch-accessible target.',
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
    'Mobile board toolbar must show undo, redo, battle log and all three view controls.',
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

async function assertFullscreenAvailable(page, surface) {
  const button = page.locator('#fullscreen-button');
  assert(
    (await button.isVisible()) && Boolean(await button.getAttribute('aria-label')),
    `${surface} must offer an accessible fullscreen button.`,
  );
}

async function assertRulesLayouts(page, surface) {
  await page.locator('[data-rule-section="desarrollo"]').click();
  const preview = page.locator('[data-rules-layout-preview]');
  await page.locator('[data-rules-layout-preview][data-renderer-status="ready"]').waitFor();
  assert(
    (await preview.getAttribute('data-layout')) === '1' &&
      (await selectedOptionLabel(page, 'Disposición inicial')) === 'Frente clásico',
    'The rules deployment preview must begin with the default classic layout.',
  );
  assert(
    (await selectOptionLabels(page, 'Disposición inicial')).join('|') ===
      Object.values(INITIAL_LAYOUT_LABELS).join('|'),
    'The rules must offer all five real initial layouts.',
  );
  assert(
    (await preview.getAttribute('role')) === 'img' &&
      Boolean(await preview.getAttribute('aria-label')) &&
      (await page.locator('#rules-article img').count()) === 0,
    'The rules deployment must use an accessible live board instead of a static image.',
  );
  const images = new Set();
  for (const [value, label] of Object.entries(INITIAL_LAYOUT_LABELS)) {
    await chooseSelectOption(page, 'Disposición inicial', label);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const rendered = await preview.evaluate((canvas) => ({
      image: canvas.toDataURL(),
      layout: canvas.dataset.layout,
      pieceCount: Number(canvas.dataset.pieceCount),
      width: canvas.getBoundingClientRect().width,
      height: canvas.getBoundingClientRect().height,
    }));
    assert(
      rendered.layout === value && rendered.pieceCount === (value === '5' ? 44 : 36),
      `Rules layout ${value} must display both complete armies from its real initial state.`,
    );
    assert(
      rendered.width > 200 && rendered.height > 150,
      `${surface} rules deployment must retain a readable board.`,
    );
    images.add(rendered.image);
  }
  assert(images.size === 5, 'Changing rule layouts must redraw five different board positions.');
  await assertNoHorizontalOverflow(page, `${surface} rules deployment`, '#game-dialog');
  await preview.scrollIntoViewIfNeeded();
  if (process.env.UI_SCREENSHOT)
    await page.screenshot({ path: `${process.env.UI_SCREENSHOT}-rules-layout-${surface}.png` });
  const selector = await openSelect(page, 'Disposición inicial');
  await assertSelectMenuWithinViewport(page, `${surface} rules layout menu`);
  assert(
    await page.getByRole('listbox').evaluate((menu) => Boolean(menu.closest('#game-dialog'))),
    'The rules layout menu must remain inside its modal dialog.',
  );
  await selector.press('Home');
  await selector.press('ArrowDown');
  assert(
    (await preview.getAttribute('data-layout')) === '5',
    'Highlighting another rule layout must leave the preview unchanged before confirmation.',
  );
  await selector.press('Enter');
  assert(
    (await preview.getAttribute('data-layout')) === '2' &&
      (await selector.evaluate((control) => control === document.activeElement)),
    'Keyboard confirmation must update the live rules board and preserve selector focus.',
  );
}

async function assertAchievementsCatalog(page, surface) {
  const opener = page.locator('[data-home-action="achievements"]');
  await opener.click();
  await page.getByRole('heading', { name: 'Logros', exact: true }).waitFor();
  const cards = page.locator('[data-achievement-id]');
  const total = await cards.count();
  assert(total === 28, `${surface} achievements must include the complete 28-item catalog.`);
  const ids = await cards.evaluateAll((items) => items.map((item) => item.dataset.achievementId));
  assert(new Set(ids).size === total, 'Each achievement must appear once in the full catalog.');
  assert(
    await cards.evaluateAll((items) =>
      items.every(
        (item) =>
          item.querySelector('h4')?.textContent?.trim() &&
          item.querySelector('.achievement-description p')?.textContent?.trim() &&
          item.querySelector('.achievement-state')?.textContent?.includes('Pendiente'),
      ),
    ),
    'Each locked achievement must explain its condition and state in text.',
  );
  const summary = page.locator('[data-achievement-summary]');
  const totals = await summary.evaluate((progress) => ({
    value: Number(progress.getAttribute('aria-valuenow') ?? progress.getAttribute('value')),
    max: Number(progress.getAttribute('aria-valuemax') ?? progress.getAttribute('max')),
  }));
  assert(
    totals.value === 0 && totals.max === total,
    'A new profile must show zero unlocked achievements and the actual catalog total.',
  );
  const progressBars = await page.getByRole('progressbar').evaluateAll((bars) =>
    bars.map((bar) => ({
      label: bar.getAttribute('aria-label') || bar.getAttribute('aria-labelledby'),
      value: Number(bar.getAttribute('aria-valuenow') ?? bar.getAttribute('value')),
      max: Number(bar.getAttribute('aria-valuemax') ?? bar.getAttribute('max')),
    })),
  );
  assert(
    progressBars.length > 1 &&
      progressBars.every(({ label, value, max }) => label && value === 0 && max > 0),
    'Locked cumulative achievements must expose their labeled, numeric progress to assistive technology.',
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-achievement-id] .achievement-icon')].every(
      (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
    ),
  );
  const icons = await cards.locator('img.achievement-icon').evaluateAll((items) =>
    items.map((item) => {
      const { width, height } = item.getBoundingClientRect();
      return {
        width,
        height,
        source: new URL(item.currentSrc).pathname,
        id: item.closest('[data-achievement-id]').dataset.achievementId,
        naturalWidth: item.naturalWidth,
        naturalHeight: item.naturalHeight,
        decorative: item.alt === '',
      };
    }),
  );
  assert(
    icons.length === total &&
      new Set(icons.map(({ source }) => source)).size === total &&
      icons.every(
        ({ width, height, source, id, naturalWidth, naturalHeight, decorative }) =>
          width > 0 &&
          Math.abs(width - height) <= 1 &&
          naturalWidth === 512 &&
          naturalWidth === naturalHeight &&
          source === `/achievements/${id}.webp` &&
          decorative,
      ),
    'All 28 achievements must load their own decorative 512×512 artwork at desktop and mobile widths.',
  );
  await assertNoHorizontalOverflow(page, `${surface} achievements`, '#game-dialog');

  const unlocked = page.getByRole('button', { name: /^Desbloqueados/ });
  await unlocked.focus();
  await unlocked.press('Enter');
  assert(
    (await unlocked.getAttribute('aria-pressed')) === 'true' && (await cards.count()) === 0,
    'The unlocked filter must be keyboard operable and exclude locked achievements.',
  );
  const pending = page.getByRole('button', { name: /^Pendientes/ });
  await pending.click();
  assert(
    (await pending.getAttribute('aria-pressed')) === 'true' && (await cards.count()) === total,
    'The pending filter must show the full catalog for a new profile.',
  );
  await page.getByRole('button', { name: /^Todos/ }).click();
  assert((await cards.count()) === total, 'The all filter must restore the complete catalog.');
  if (process.env.UI_SCREENSHOT)
    await page.screenshot({
      path: `${process.env.UI_SCREENSHOT}-achievements-${surface.toLowerCase()}.png`,
    });
  await page.keyboard.press('Escape');
  await page.locator('#game-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() =>
    document.activeElement?.matches('[data-home-action="achievements"]'),
  );
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

async function assertSelectMenuWithinViewport(page, label) {
  const menu = page.getByRole('listbox');
  const box = await menu.boundingBox();
  const viewport = page.viewportSize();
  assert(
    box &&
      viewport &&
      box.x >= -1 &&
      box.y >= -1 &&
      box.x + box.width <= viewport.width + 1 &&
      box.y + box.height <= viewport.height + 1,
    `${label} must stay inside the viewport: ${JSON.stringify({ box, viewport })}.`,
  );
  const targets = await page.getByRole('option').evaluateAll((options) =>
    options.map((option) => {
      const rect = option.getBoundingClientRect();
      return { text: option.textContent, width: rect.width, height: rect.height };
    }),
  );
  assert(
    targets.length > 0 && targets.every(({ width, height }) => width >= 44 && height >= 44),
    `${label} must offer 44px touch targets: ${JSON.stringify(targets)}.`,
  );
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
