import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

// Run with pnpm exec node scripts/interception-smoke.mjs.
const executablePath =
  process.env.PLAYWRIGHT_BROWSER_PATH ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].find(existsSync);
assert(executablePath, 'Set PLAYWRIGHT_BROWSER_PATH to an installed Chromium browser.');
const screenshotDirectory =
  process.env.INTERCEPTION_SCREENSHOTS || mkdtempSync(join(tmpdir(), 'hex-interception-'));
mkdirSync(screenshotDirectory, { recursive: true });
const server = await createServer({
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: 0,
    hmr: false,
    watch: { ignored: ['**/.pnpm-store/**'] },
  },
});
await server.listen();
const address = server.httpServer.address();
assert(address && typeof address === 'object');
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];

try {
  const { createClassicConfig } = await server.ssrLoadModule('/src/game-config.ts');
  const { createMatchRecord, parseRecord, replayRecord, serializeRecord } =
    await server.ssrLoadModule('/src/match-record.ts');
  const { applyAction } = await server.ssrLoadModule('/src/engine.ts');
  const config = createClassicConfig({ mode: 'local', fixedBoard: true });
  const pieces = [
    { id: 'blue-fortress', type: 'fortress', owner: 0, position: { q: -5, r: 0 }, hp: 2 },
    { id: 'blue-soldier', type: 'soldier', owner: 0, position: { q: -4, r: 0 }, facing: 3 },
    { id: 'blue-drone', type: 'drone', owner: 0, position: { q: 0, r: 0 } },
    { id: 'amber-ground', type: 'soldier', owner: 1, position: { q: 1, r: 0 }, facing: 0 },
    { id: 'amber-shield', type: 'antiAir', owner: 1, position: { q: 2, r: 0 } },
    { id: 'amber-fortress', type: 'fortress', owner: 1, position: { q: 5, r: 0 }, hp: 2 },
  ];
  config.setup = pieces.map((piece) => ({ id: piece.id, piece }));
  const initialRecord = serializeRecord(createMatchRecord(config));

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const mobile = viewport.width < 900;
    const context = await browser.newContext({
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      page.setDefaultNavigationTimeout(30_000);
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.addInitScript((record) => {
        if (!localStorage.getItem('atlas-match-classic-v2'))
          localStorage.setItem('atlas-match-classic-v2', record);
        localStorage.setItem(
          'atlas-preferences-v2',
          JSON.stringify({
            reducedMotion: true,
            sound: false,
            fixedBoard: true,
            boardDepth: false,
            confirmation: 'always',
            idleAnimations: false,
          }),
        );
      }, initialRecord);
      await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'networkidle' });
      await page.locator('[data-home-action="continue"]').click();
      await page.locator('#game-canvas[data-renderer-status="ready"]').waitFor();
      await clickHex(page, { q: 0, r: 0 });
      assert.match(await page.locator('#piece-card h2').textContent(), /Dron/);
      for (const q of [1, 2, 3]) {
        assert.match(
          await page.locator(`#sr-board [data-hex="${q},0"]`).textContent(),
          /Acciones legales:/,
          `The protected destination ${q},0 must remain selectable.`,
        );
      }
      await assertWarningPixels(
        page,
        [1, 2, 3].map((q) => ({ q, r: 0 })),
      );
      await captureBoard(page, join(screenshotDirectory, `${viewport.width}-warnings.png`));
      if (mobile) {
        await page.locator('#game-canvas').focus();
        await page.keyboard.press('e');
        await page.keyboard.press('e');
        assert.equal(
          await page.locator('#sr-board [aria-selected="true"]').getAttribute('data-hex'),
          '2,0',
        );
        await page.keyboard.press('Enter');
      } else {
        await clickHex(page, { q: 2, r: 0 });
      }
      await page.locator('#pending-card .confirm-button').waitFor();
      assert.match(await page.locator('#piece-card h2').textContent(), /Dron/);
      const preview = await page.locator('#pending-card').textContent();
      assert.match(preview, /hacia \[\+2, \+0\]/);
      assert.match(preview, /será interceptado en \[\+1, \+0\]/);
      assert.equal(await page.locator('#battle-log li:not(.empty-log)').count(), 0);
      await captureBoard(page, join(screenshotDirectory, `${viewport.width}-pending.png`));
      await page.locator('#pending-card .confirm-button').click();
      await page.locator('#undo-action:not([disabled])').waitFor();
      const saved = parseRecord(
        await page.evaluate(() => localStorage.getItem('atlas-match-classic-v2')),
      );
      assert.equal(saved.currentAction, 1);
      assert.equal(saved.actions.length, 1);
      assert.equal(saved.actions[0].kind, 'move');
      assert.equal(saved.actions[0].pieceId, 'blue-drone');
      assert.deepEqual(saved.actions[0].to, { q: 2, r: 0 });
      const resolution = applyAction(saved.initialState, saved.actions[0]);
      assert(resolution.ok);
      assert.deepEqual(
        resolution.events.find((event) => event.type === 'intercept')?.at,
        { q: 1, r: 0 },
        'The requested destination must remain 2,0 while interception happens at 1,0.',
      );
      const restored = replayRecord(saved);
      assert.equal(
        restored.pieces.some(({ id }) => id === 'blue-drone'),
        false,
      );
      for (const id of ['amber-ground', 'amber-shield'])
        assert.deepEqual(
          restored.pieces.find((piece) => piece.id === id),
          pieces.find((piece) => piece.id === id),
          'Interception must preserve the ground unit and the shield.',
        );
      assert.match(await page.locator('#sr-board [data-hex="0,0"]').textContent(), /vacía/);
      assert.match(await page.locator('#sr-board [data-hex="1,0"]').textContent(), /SOL/);
      assert.match(await page.locator('#sr-board [data-hex="2,0"]').textContent(), /EAA/);
      const completedBoard = await page.locator('#sr-board').textContent();
      const completedLog = await page.locator('#battle-log li p').first().textContent();
      assert.equal(completedLog, 'Dron fue interceptado en [+1, +0].');
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('[data-home-action="continue"]').click();
      await page.locator('#game-canvas[data-renderer-status="ready"]').waitFor();
      assert.equal(await page.locator('#sr-board').textContent(), completedBoard);
      await page.locator('[data-open-replay]').click();
      assert.equal(await page.locator('[data-replay-description]').textContent(), completedLog);
      assert.equal(await page.locator('#sr-board').textContent(), completedBoard);
      await page.locator('[data-replay-step="-1"]').click();
      assert.match(await page.locator('#sr-board [data-hex="0,0"]').textContent(), /DRN/);
      await page.locator('[data-replay-step="1"]').click();
      assert.equal(await page.locator('#sr-board').textContent(), completedBoard);
      assert.equal(await page.locator('[data-replay-description]').textContent(), completedLog);
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'Interception and replay must not introduce horizontal overflow.',
      );
      console.log(
        `Interception ${viewport.width}: warnings, order, save/resume and replay passed.`,
      );
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Interception screenshots: ${screenshotDirectory}`);
} finally {
  await browser.close();
  await server.close();
}

async function canvasGeometry(page) {
  const canvas = page.locator('#game-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert(box);
  const scale = Math.max(0.38, Math.min((box.width - 34) / 560, (box.height - 42) / 610));
  return { canvas, box, scale };
}

function canvasPoint(hex, box, scale) {
  return {
    x: box.width / 2 - 45 * hex.q * scale,
    y: box.height / 2 - Math.sqrt(3) * 30 * (hex.r + hex.q / 2) * scale,
  };
}

async function clickHex(page, hex) {
  const { box, scale } = await canvasGeometry(page);
  const point = canvasPoint(hex, box, scale);
  await page.mouse.click(box.x + point.x, box.y + point.y);
}

async function captureBoard(page, path) {
  await canvasGeometry(page);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({ path });
}

async function assertWarningPixels(page, cells) {
  const { canvas, box, scale } = await canvasGeometry(page);
  const image = await canvas.screenshot();
  const samples = await page.evaluate(
    async ({ png, points, scale }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const probe = document.createElement('canvas');
      probe.width = image.width;
      probe.height = image.height;
      const context = probe.getContext('2d');
      context.drawImage(image, 0, 0);
      return points.map(({ x, y }) => {
        const radius = Math.ceil(9 * scale);
        const pixels = context.getImageData(
          Math.floor(x - radius),
          Math.floor(y - radius),
          radius * 2,
          radius * 2,
        ).data;
        let warningPixels = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          // The coral warning ink differs from the amber occupant and its yellow outline.
          if (
            pixels[index] > 195 &&
            pixels[index + 1] >= 80 &&
            pixels[index + 1] <= 145 &&
            pixels[index + 2] >= 55 &&
            pixels[index + 2] <= 120
          )
            warningPixels++;
        }
        return warningPixels;
      });
    },
    {
      png: image.toString('base64'),
      points: cells.map((cell) => canvasPoint(cell, box, scale)),
      scale,
    },
  );
  assert(
    samples.every((pixels) => pixels > 0),
    `Every dangerous destination must show warning ink above its occupant: ${samples.join(', ')}.`,
  );
}
