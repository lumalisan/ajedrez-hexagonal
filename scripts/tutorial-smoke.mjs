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
    { width: 1024, height: 768 },
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
    await page.locator('#app.tutorial-active #tutorial-panel[data-tutorial-step="1.1"]').waitFor();
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const desktop = viewport.width >= 901;
    const canvasBeforeSelection = await page.locator('#game-canvas').boundingBox();
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
      const canvasBeforeAction = await page.locator('#game-canvas').boundingBox();
      if (await page.locator('#command-panel').isVisible())
        await assertDisabledWindowControls(page);
      if (plan.id === '3.1' && desktop) {
        await assertCanvasBounds(page, canvasBeforeSelection, 'Opening the tutorial command panel');
        await assertFloatingCommandWindow(page, canvasBeforeAction);
      }
      if (plan.id === '3.2') {
        await assertDisabledWindowControls(page, true);
        assert(
          await page.locator('#pending-card .confirm-button').isVisible(),
          'Disabled window controls must preserve the prepared tutorial action.',
        );
        if (desktop)
          await assertCanvasBounds(page, canvasBeforeAction, 'Clicking disabled window controls');
      }
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
      if (plan.interaction === 'free') {
        await clickHex(page, plan.actor.position);
        await assertDisabledWindowControls(page, true);
        if (desktop)
          await assertCanvasBounds(
            page,
            canvasBeforeAction,
            'Selecting a unit during free practice',
          );
        break;
      }
      if (plan.interaction === 'next') {
        await uncoverControl(page, '#tutorial-next');
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
        await assertDisabledWindowControls(page);
        if (desktop)
          await assertCanvasBounds(page, canvasBeforeAction, `Selecting a unit in ${plan.id}`);
      }
      if (plan.mode) {
        await page.locator(`[data-command="${plan.mode}"]`).click();
        await page
          .locator(
            `[data-${plan.mode === 'transform' ? 'transform-facing' : 'direction-order'}="${plan.direction}"]`,
          )
          .click();
        if (desktop)
          await assertCanvasBounds(page, canvasBeforeAction, `Changing action mode in ${plan.id}`);
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
      if (desktop)
        await assertCanvasBounds(page, canvasBeforeAction, `Preparing an action in ${plan.id}`);
      if (plan.interaction !== 'prepare')
        await page.locator('#pending-card .confirm-button').click();
      console.log(`Tutorial ${viewport.width}: ${plan.id} passed.`);
    }
    await uncoverControl(page, '#tutorial-previous');
    await page.locator('#tutorial-previous').click();
    await page.locator('#tutorial-panel[data-tutorial-step="13.1"]').waitFor();
    await uncoverControl(page, '#tutorial-previous');
    await page.locator('#tutorial-previous').click();
    await page.locator('#tutorial-panel[data-tutorial-step="12.1"]').waitFor();
    await page.locator('#new-game-button').click();
    await page.locator('[data-home-action="tutorial"]').waitFor();
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Tutorial: 37 steps, section navigation, disabled window controls, desktop dragging/keyboard movement, stable board and Axe pass at 1440, 1024 and 390 pixels.',
  );
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
  const x = box.x + box.width / 2 - 45 * hex.q * scale;
  const y = box.y + box.height / 2 - Math.sqrt(3) * 30 * (hex.r + hex.q / 2) * scale;
  await uncoverBoardTarget(page, { x, y });
  await page.mouse.click(x, y);
}

async function assertCanvasBounds(page, expected, action) {
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const current = await page.locator('#game-canvas').boundingBox();
  assert(
    expected &&
      current &&
      ['x', 'y', 'width', 'height'].every((key) => Math.abs(current[key] - expected[key]) <= 1),
    `${action} must not move or resize the board: ${JSON.stringify({ expected, current })}.`,
  );
}

async function assertDisabledWindowControls(page, click = false) {
  for (const selector of ['#minimize-command-panel', '#close-command-panel']) {
    const control = page.locator(selector);
    assert(await control.isVisible(), `${selector} must remain visible during the tutorial.`);
    assert(await control.isDisabled(), `${selector} must be disabled during the tutorial.`);
    if (click) {
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      assert(box);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      assert(
        await page.locator('#command-panel').isVisible(),
        `${selector} must not hide the tutorial command panel.`,
      );
      assert(
        await page.locator('#command-panel-restore').isHidden(),
        'Disabled window controls must not reveal the restore button.',
      );
    }
  }
}

async function dragCommandWindow(page, deltaX, deltaY) {
  const box = await page.locator('#command-window-titlebar').boundingBox();
  assert(box, 'The tutorial command titlebar must be visible for dragging.');
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
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function assertFloatingCommandWindow(page, canvasBounds) {
  const panel = page.locator('#command-panel');
  const before = await panel.boundingBox();
  assert(before);
  await dragCommandWindow(page, -160, 35);
  const dragged = await panel.boundingBox();
  assert(
    dragged && dragged.x < before.x - 100 && dragged.y > before.y + 20,
    'Dragging must move the tutorial command panel independently of the board.',
  );
  await assertCanvasBounds(page, canvasBounds, 'Dragging the tutorial command panel');
  const titlebar = page.locator('#command-window-titlebar');
  await titlebar.focus();
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'command-window-titlebar',
    'The tutorial titlebar must accept keyboard focus.',
  );
  await titlebar.press('ArrowLeft');
  await page.waitForFunction(
    (previousX) => document.querySelector('#command-panel').getBoundingClientRect().x < previousX,
    dragged.x,
  );
  const afterArrow = await panel.boundingBox();
  assert(
    afterArrow && afterArrow.x < dragged.x && Math.abs(afterArrow.y - dragged.y) <= 1,
    `Arrow keys must move the focused tutorial command panel: ${JSON.stringify({ dragged, afterArrow })}.`,
  );
  await titlebar.press('Shift+ArrowDown');
  await page.waitForFunction(
    (previousY) => document.querySelector('#command-panel').getBoundingClientRect().y > previousY,
    afterArrow.y,
  );
  const afterShiftArrow = await panel.boundingBox();
  assert(
    afterShiftArrow && afterShiftArrow.y - afterArrow.y > dragged.x - afterArrow.x,
    `Shift and an arrow must move the tutorial command panel farther than a plain arrow: ${JSON.stringify({ dragged, afterArrow, afterShiftArrow })}.`,
  );
  await assertCanvasBounds(
    page,
    canvasBounds,
    'Moving the tutorial command panel with the keyboard',
  );
  await dragCommandWindow(page, before.x - afterShiftArrow.x, before.y - afterShiftArrow.y);
}

async function uncoverBoardTarget(page, target) {
  if (page.viewportSize().width < 901) return;
  const panel = await page.locator('#command-panel').boundingBox();
  const covers = (box) =>
    target.x >= box.x - 8 &&
    target.x <= box.x + box.width + 8 &&
    target.y >= box.y - 8 &&
    target.y <= box.y + box.height + 8;
  if (!panel || !covers(panel)) return;
  const arena = await page.locator('#board-arena').boundingBox();
  assert(arena);
  const candidate = [
    { x: arena.x + arena.width - panel.width - 16, y: arena.y + 16 },
    {
      x: arena.x + arena.width - panel.width - 16,
      y: arena.y + arena.height - panel.height - 16,
    },
    { x: arena.x + 16, y: arena.y + 16 },
  ].find((position) => !covers({ ...panel, ...position }));
  assert(candidate, 'The command panel must leave a playable location for the indicated cell.');
  const canvasBefore = await page.locator('#game-canvas').boundingBox();
  await dragCommandWindow(page, candidate.x - panel.x, candidate.y - panel.y);
  const moved = await page.locator('#command-panel').boundingBox();
  assert(moved && !covers(moved), 'Dragging the command panel must uncover the indicated cell.');
  await assertCanvasBounds(page, canvasBefore, 'Moving the command panel away from an objective');
}

async function uncoverControl(page, selector) {
  const box = await page.locator(selector).boundingBox();
  assert(box, `${selector} must be available during the tutorial.`);
  await uncoverBoardTarget(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}
