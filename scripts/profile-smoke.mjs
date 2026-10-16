import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const executablePath =
  process.env.PLAYWRIGHT_BROWSER_PATH ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium',
  ].find(existsSync);
assert(executablePath);
const server = await createServer({
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
await server.listen();
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
const screenshotDir = process.env.PROFILE_SCREENSHOTS;
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`, {
      waitUntil: 'networkidle',
    });
    assert(
      (await page.locator('.home-shortcut-story').boundingBox()).height <= 56,
      'The story button must stay compact.',
    );
    const tiers = await page.evaluate(async () => {
      const { TIERS, xpForLevel, createPlayerProgression } = await import('/src/progression.ts');
      return TIERS.map((tier) => ({
        ...tier,
        progress: { ...createPlayerProgression(), xp: xpForLevel(tier.level) },
      }));
    });
    if (screenshotDir)
      await page.screenshot({ path: `${screenshotDir}/home-${viewport.width}.png` });
    for (const [index, tier] of tiers.entries()) {
      await page.evaluate(
        (progress) => localStorage.setItem('hexagonal:progression:v1', JSON.stringify(progress)),
        tier.progress,
      );
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.home-profile').click();
      assert(
        (await page.locator('.progression-summary').textContent()).includes(
          `Nivel ${tier.level} – ${tier.name}`,
        ),
      );
      assert.equal(
        await page.locator('.profile-header .profile-stars').textContent(),
        '★'.repeat(index + 1),
      );
      await page.getByRole('button', { name: 'Configuración', exact: true }).click();
      for (const kind of ['emblem', 'color']) {
        assert.equal(await page.locator(`input[name="profile-${kind}"]`).count(), 10);
        assert.equal(
          await page.locator(`input[name="profile-${kind}"]:enabled`).count(),
          (index + 1) * 2,
        );
      }
      if (index === 0 && screenshotDir)
        await page.screenshot({ path: `${screenshotDir}/settings-${viewport.width}.png` });
      await page.locator('.profile-header .profile-link').click();
      await page.getByRole('heading', { name: 'Tu perfil', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Ver logros', exact: true }).click();
      assert(
        !(await page.locator('.progression-summary').textContent()).includes('Racha de actividad'),
      );
      assert(
        !(await page.locator('.achievements-result-count').textContent()).includes('logros ·'),
      );
      await page.locator(`[data-achievement-tier="${index}"]`).click();
      const symbols = await page
        .locator('[data-achievement-id] .achievement-symbol')
        .allTextContents();
      assert.equal(symbols.length, 20);
      assert.equal(new Set(symbols).size, 20);
      if (index === 0 && screenshotDir) {
        await page.screenshot({ path: `${screenshotDir}/achievements-${viewport.width}.png` });
      }
      await page.locator('.achievements-player.profile-link').click();
      await page.getByRole('heading', { name: 'Tu perfil', exact: true }).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.getByRole('button', { name: 'Cerrar perfil', exact: true }).click();
    }
    await page.evaluate(async () => {
      const { createClassicConfig } = await import('/src/game-config.ts');
      const { createMatchRecord, appendAction } = await import('/src/match-record.ts');
      const { getAllLegalActions } = await import('/src/engine.ts');
      const { saveActiveMatch } = await import('/src/match-storage.ts');
      const record = createMatchRecord(createClassicConfig({ mode: 'local' }));
      saveActiveMatch(
        appendAction(
          record,
          getAllLegalActions(record.initialState).find((a) => a.kind === 'rotate'),
        ),
      );
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-home-action="continue"]').click();
    await page.locator('[data-continue-match]').first().click();
    await page.locator('[data-open-replay]').click();
    assert.equal(await page.locator('#new-game-button').textContent(), 'Abandonar repetición');
    await page.setViewportSize({ width: 390, height: 844 });
    const title = await page.locator('#replay-window-titlebar').boundingBox();
    await page.mouse.move(title.x + 24, title.y + title.height / 2);
    await page.mouse.down();
    await page.mouse.move(title.x + 24, title.y + title.height / 2 + 70, { steps: 8 });
    await page.mouse.up();
    await page.locator('#minimize-replay').click();
    await page.locator('#replay-restore').click();
    await page.setViewportSize({ width: 568, height: 320 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const bounds = await page.locator('.replay-dock').boundingBox();
    assert(
      bounds.x >= 0 &&
        bounds.y >= 0 &&
        bounds.x + bounds.width <= 568 &&
        bounds.y + bounds.height <= 320,
      JSON.stringify({
        bounds,
        layout: await page.evaluate(() =>
          ['.app-shell', '.topbar', '.game-layout', '.board-arena'].map((selector) => ({
            selector,
            bounds: document.querySelector(selector).getBoundingClientRect().toJSON(),
            height: getComputedStyle(document.querySelector(selector)).height,
            rows: getComputedStyle(document.querySelector(selector)).gridTemplateRows,
          })),
        ),
      }),
    );
    await page.locator('#new-game-button').click();
    await page.locator('[data-home-action="new"]').waitFor();
    assert.equal(await page.locator('#game-dialog[open]').count(), 0);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Profile: all five categories, 10 emblems/colors, progressive unlocks, stars, unique achievement icons and profile links pass at desktop and mobile widths.',
  );
} finally {
  await browser.close();
  await server.close();
}
