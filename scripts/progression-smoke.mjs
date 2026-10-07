import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { chooseSelectOption } from './select-helpers.mjs';

const executablePath =
  process.env.PLAYWRIGHT_BROWSER_PATH ||
  [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].find(existsSync);
if (!executablePath) throw new Error('Set PLAYWRIGHT_BROWSER_PATH to Chrome or Edge.');
const server = await createServer({
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 4176, strictPort: true, hmr: false },
});
await server.listen();
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
try {
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:4176', { waitUntil: 'networkidle' });
    await page.locator('[data-home-action="achievements"]').click();
    await page.getByRole('heading', { name: 'Logros', exact: true }).waitFor();
    assert(
      (await page.locator('[data-achievement-id]').count()) === 20,
      'A beginner sees 20 achievements.',
    );
    assert(
      (await page.locator('[data-achievement-id] .achievement-description p').count()) === 15,
      'Five secrets hide their conditions.',
    );
    assert(
      (await page.locator('[data-achievement-id="p1-18"] progress').count()) === 0,
      'Secret progress stays hidden.',
    );
    await page.getByRole('progressbar', { name: 'Experiencia para el siguiente nivel' }).waitFor();
    await page.screenshot({ path: join(tmpdir(), `progression-${name}-achievements.png`) });
    await page.keyboard.press('Escape');
    await page.locator('[data-home-action="ranking"]').click();
    await page.getByRole('heading', { name: 'Clasificación', exact: true }).waitFor();
    assert(
      (await page.locator('.ranking-table tbody td').last().textContent()) === '1000',
      'Initial Elo is 1000.',
    );
    await page.screenshot({ path: join(tmpdir(), `progression-${name}-ranking.png`) });
    await chooseSelectOption(page, 'Periodo', 'Últimos 30 días');
    assert(
      (await page.locator('.ranking-table caption').textContent()) ===
        'Clasificación de los últimos 30 días',
      'Monthly view is available.',
    );
    await chooseSelectOption(page, 'Modalidad', 'En línea');
    assert(
      await page
        .getByText('Las partidas en línea aún no están disponibles.', { exact: false })
        .isVisible(),
      'Online availability is explicit.',
    );
    await page.keyboard.press('Escape');
    await page.locator('[data-home-action="profile"]').click();
    await page.getByRole('heading', { name: 'Tu perfil', exact: true }).waitFor();
    assert(
      await page.getByText('Nivel 1', { exact: true }).isVisible(),
      'The profile shows the level.',
    );
    await page.screenshot({ path: join(tmpdir(), `progression-${name}-profile.png`) });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const progress = JSON.parse(localStorage.getItem('hexagonal:progression:v1'));
      progress.xp = 133650;
      progress.activity.lastDay = null;
      localStorage.setItem('hexagonal:progression:v1', JSON.stringify(progress));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-home-action="achievements"]').click();
    await page.getByRole('heading', { name: 'Logros', exact: true }).waitFor();
    assert(
      (await page.locator('[data-achievement-id]').count()) === 100,
      'Level 100 opens all five categories.',
    );
    await page.getByRole('button', { name: 'Desbloqueados', exact: true }).click();
    assert(
      (await page.locator('[data-achievement-id="p5-18"]').count()) === 1,
      'Reaching 100 awards its achievement.',
    );
    assert(
      (await page.locator('[data-achievement-id="p5-18"] .achievement-description p').count()) ===
        1,
      'An unlocked secret reveals its condition.',
    );
    await page.close();
    console.log(`Progression passed: ${name} / XP, secrets, categories, profile and ranking.`);
  }
  assert(errors.length === 0, errors.join('\n'));
} finally {
  await browser.close();
  await server.close();
}
