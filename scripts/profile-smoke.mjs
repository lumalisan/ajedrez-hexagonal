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
    await page.locator('#home-settings-button').click();
    assert.equal(await page.getByRole('button', { name: 'Historial de resultados' }).count(), 0);
    await page.getByRole('button', { name: 'Cerrar ajustes sin guardar' }).click();
    await page.locator('[data-home-action="new"]').click();
    assert.match(
      await page.locator('[data-home-mode="machine"]').textContent(),
      /Individual Vs\. Hexfortia/,
    );
    assert.match(await page.locator('[data-home-mode="local"]').textContent(), /Batalla local/);
    await page.locator('[data-home-mode="machine"]').click();
    await page.locator('[data-layout-preview][data-renderer-status="ready"]').waitFor();
    assert.equal(
      await page.getByText('Las partidas contra Hexfortia se juegan con tiempo ilimitado.').count(),
      0,
    );
    assert.equal(await page.locator('[data-layout-description]').count(), 0);
    if (screenshotDir)
      await page.screenshot({ path: `${screenshotDir}/config-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Cerrar configuración', exact: true }).click();
    await page.locator('[data-home-action="back"]').click();
    const allArtworkSources = new Set();
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
      assert.deepEqual(
        await page
          .locator('input[name="profile-emblem"]')
          .evaluateAll((inputs) => inputs.map((input) => input.value)),
        [
          'fortress',
          'hex',
          'shield',
          'swords',
          'wing',
          'flame',
          'compass',
          'laurel',
          'crown',
          'star',
        ],
      );
      const colors = await page
        .locator('input[name="profile-color"]')
        .evaluateAll((inputs) => inputs.map((input) => input.value));
      assert.deepEqual(colors.slice(0, 3), ['cyan', 'emerald', 'amber']);
      assert.deepEqual(colors.slice(-2), ['silver', 'gold']);
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
        .locator('[data-achievement-id] .achievement-insignia')
        .evaluateAll(async (icons) =>
          Promise.all(
            icons.map(async (icon) => {
              await icon.decode();
              if (icon.naturalWidth !== 512 || icon.naturalHeight !== 400)
                throw new Error('Achievement art must load at 512×400.');
              return icon.getAttribute('src');
            }),
          ),
        );
      assert.equal(symbols.length, 20);
      assert.equal(new Set(symbols).size, 20);
      symbols.forEach((source) => allArtworkSources.add(source));
      if (index === 0 && screenshotDir) {
        await page.screenshot({ path: `${screenshotDir}/achievements-${viewport.width}.png` });
      }
      await page.locator('.achievements-player.profile-link').click();
      await page.getByRole('heading', { name: 'Tu perfil', exact: true }).waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.getByRole('button', { name: 'Cerrar perfil', exact: true }).click();
    }
    assert.equal(allArtworkSources.size, 100);
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
    await page.setViewportSize(viewport);
    for (const [mode, xp] of [
      ['local', 300],
      ['local', 120],
      ['machine', 120],
    ]) {
      const matchId = await page.evaluate(
        async ({ mode, xp }) => {
          const { createClassicConfig } = await import('/src/game-config.ts');
          const { createMatchRecord, appendAction } = await import('/src/match-record.ts');
          const { getAllLegalActions } = await import('/src/engine.ts');
          const { saveActiveMatch } = await import('/src/match-storage.ts');
          const { createPlayerProgression } = await import('/src/progression.ts');
          const progress = { ...createPlayerProgression(), xp };
          const record = createMatchRecord(
            createClassicConfig({
              mode,
              initialLayout: 3,
              playerNames: ['Comandante de prueba', 'Invitado'],
            }),
          );
          progress.registeredMatchIds.push(record.createdAt);
          localStorage.setItem('hexagonal:progression:v1', JSON.stringify(progress));
          saveActiveMatch(
            appendAction(
              record,
              getAllLegalActions(record.initialState).find((action) => action.kind === 'rotate'),
            ),
          );
          return record.createdAt;
        },
        { mode, xp },
      );
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('[data-home-action="continue"]').click();
      await page.locator(`[data-continue-match="${matchId}"]`).click();
      await page.locator('#resign-button').click();
      await page.locator('[data-confirm-resign]').click();
      await page.locator('.battle-progression[data-xp-animation="complete"]').waitFor();
      const panel = await page.locator('.battle-progression').textContent();
      assert.match(panel, /\d[\d.]* XP acumulados/);
      assert.equal(panel.includes('¡Has subido'), xp === 120, JSON.stringify({ mode, xp, panel }));
      const summary = await page.locator('.battle-record-stats').textContent();
      assert(summary.includes('unidades eliminadas por Comandante de prueba'));
      assert(
        summary.includes(
          `unidades eliminadas por ${mode === 'machine' ? 'Hexfortia' : 'Invitado'}`,
        ),
      );
      if (mode === 'machine' && screenshotDir)
        await page.screenshot({ path: `${screenshotDir}/outcome-${viewport.width}.png` });
      await page.locator('[data-new-game]').click();
    }
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
