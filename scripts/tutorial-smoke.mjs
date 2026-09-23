import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'vite';

const executablePath =
  process.env.PLAYWRIGHT_BROWSER_PATH ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].find(existsSync);
assert(executablePath, 'Set PLAYWRIGHT_BROWSER_PATH to an installed Chromium browser.');
const server = await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
await server.listen();
const address = server.httpServer.address();
assert(address && typeof address === 'object');
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
if (process.env.TUTORIAL_SCREENSHOTS)
  mkdirSync(process.env.TUTORIAL_SCREENSHOTS, { recursive: true });
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() =>
      localStorage.setItem(
        'atlas-preferences-v2',
        JSON.stringify({
          reducedMotion: true,
          sound: false,
          confirmation: 'quick',
          idleAnimations: false,
        }),
      ),
    );
    await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'networkidle' });
    await page.locator('[data-home-action="tutorial"]').click();
    await page.locator('#game-canvas[data-renderer-status="ready"]').waitFor();
    const plans = await page.evaluate(async () => {
      const { TUTORIAL_STEPS, createTutorialCheckpoint, getTutorialActions } =
        await import('/src/tutorial.ts');
      const { actionDestination, getPiece } = await import('/src/engine.ts');
      return TUTORIAL_STEPS.map((step, index) => {
        const entry = createTutorialCheckpoint(index);
        const action = getTutorialActions(entry.state, index)[0];
        const actor = getPiece(entry.state, action?.pieceId ?? step.pieceId ?? '');
        return {
          ...step,
          actor,
          action,
          destination: action && actionDestination(entry.state, action),
        };
      });
    });
    for (let index = 0; index < plans.length; index++) {
      const plan = plans[index];
      await page.locator(`#tutorial-panel[data-tutorial-step="${plan.id}"]`).waitFor();
      await page.waitForFunction(
        () =>
          !document.querySelector('#tutorial-next')?.disabled ||
          document.querySelector('#tutorial-panel')?.getAttribute('data-tutorial-step') === '14.1',
      );
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `Overflow at ${viewport.width}/${plan.id}`,
      );
      if (['1.1', '3.2', '5.2', '10.2', '14.1'].includes(plan.id)) {
        const result = await new AxeBuilder({ page }).analyze();
        assert.equal(
          result.violations.length,
          0,
          `${viewport.width}/${plan.id}: ${JSON.stringify(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })))}`,
        );
        if (process.env.TUTORIAL_SCREENSHOTS) {
          // A WebGL canvas outside the viewport is not captured by full-page screenshots.
          await page.locator('#game-canvas').scrollIntoViewIfNeeded();
          const canvasBounds = await page.locator('#game-canvas').boundingBox();
          await page.mouse.move(
            canvasBounds.x + canvasBounds.width / 2,
            canvasBounds.y + canvasBounds.height / 2,
          );
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          await page.screenshot({
            path: `${process.env.TUTORIAL_SCREENSHOTS}/${viewport.width}-${plan.id}.png`,
          });
        }
      }
      if (plan.interaction === 'free') break;
      if (plan.interaction === 'next') {
        await page.locator('#tutorial-next').click();
        continue;
      }
      if (plan.interaction === 'inspect') {
        await clickHex(page, plan.target);
        continue;
      }
      if (plan.interaction === 'select') {
        await clickHex(page, plan.actor.position);
        continue;
      }
      if (!plan.autoSelect) {
        if (plan.id === '3.3') await page.locator('#game-canvas').press('u');
        else await clickHex(page, plan.actor.position);
        const choice = page.locator(`[data-piece-choice="${plan.actor.id}"]`);
        if (await choice.isVisible()) await choice.click();
      }
      if (plan.mode) {
        await page.locator(`[data-command="${plan.mode}"]`).click();
        await page
          .locator(
            `[data-${plan.mode === 'transform' ? 'transform-facing' : 'direction-order'}="${plan.direction}"]`,
          )
          .click();
      }
      if (plan.id === '5.2') {
        assert(
          await page.locator('#pending-card .confirm-button').isDisabled(),
          'Tank move requires choosing NE.',
        );
        await page.locator(`[data-pending-cannon="${plan.direction}"]`).click();
      } else if (plan.action.kind === 'attackAbove' || plan.action.kind === 'attackBelow') {
        await page
          .locator(`[data-command="${plan.action.kind === 'attackAbove' ? 'above' : 'below'}"]`)
          .click();
      } else if (plan.action.kind === 'convert' && plan.id === '11.2') {
        await page.locator('[data-command="capture-above"]').click();
      } else if (!['rotate', 'orient'].includes(plan.action.kind) && plan.id !== '3.2') {
        await clickHex(page, plan.id === '12.2' ? plan.target : plan.destination);
        const choices = page.locator('[data-action-choice]:not(:disabled)');
        if (await choices.count()) await choices.first().click();
      }
      if (plan.interaction !== 'prepare')
        await page.locator('#pending-card .confirm-button').click();
      console.log(`Tutorial ${viewport.width}: ${plan.id} passed.`);
    }
    await page.locator('#tutorial-previous').click();
    await page.locator('#tutorial-panel[data-tutorial-step="13.1"]').waitFor();
    await page.locator('#tutorial-previous').click();
    await page.locator('#tutorial-panel[data-tutorial-step="12.1"]').waitFor();
    await page.locator('#new-game-button').click();
    await page.locator('[data-home-action="tutorial"]').waitFor();
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Tutorial: 37 steps, section navigation and Axe pass at desktop and mobile sizes.');
} finally {
  await browser.close();
  await server.close();
}

async function clickHex(page, hex) {
  const canvas = page.locator('#game-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert(box);
  const scale = Math.max(0.38, Math.min((box.width - 34) / 560, (box.height - 42) / 610));
  await page.mouse.click(
    box.x + box.width / 2 - 45 * hex.q * scale,
    box.y + box.height / 2 - Math.sqrt(3) * 30 * (hex.r + hex.q / 2) * scale,
  );
}
