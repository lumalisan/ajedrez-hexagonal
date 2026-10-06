import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'vite';
import { STORY_CHAPTERS } from '../src/story-content.ts';

const executablePath =
  process.env.PLAYWRIGHT_BROWSER_PATH ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find(existsSync);
const server = await createServer({
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 4176, strictPort: true, hmr: false },
});
await server.listen();
let browser;
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  browser = await chromium.launch({ executablePath, headless: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on('pageerror', (error) => console.error(error));
    await page.goto('http://127.0.0.1:4176', { waitUntil: 'networkidle' });
    const profile = page.locator('[data-home-action="profile"]');
    assert(
      (await page.locator('.home-navigation button').count()) === 2,
      'Only match actions use bars.',
    );
    assert(
      (await page.locator('.home-shortcuts button').count()) === 7,
      'All compact destinations are present.',
    );
    assert(
      (await page.locator('.home-utility-actions #home-settings-button').count()) === 0,
      'Settings belongs inside the menu.',
    );
    const assertVisibleProfile = async () => {
      const bounds = await profile.boundingBox();
      assert(
        bounds && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height,
        'Profile must be visible without scrolling.',
      );
    };
    await assertVisibleProfile();
    await page.screenshot({ path: join(tmpdir(), `hex-menu-${viewport.width}.png`) });
    await page.locator('[data-home-action="story"]').click();
    await page.getByRole('heading', { name: 'El dilema de Hexfortia', exact: true }).waitFor();
    assert(
      (await page.getByRole('tab').count()) === STORY_CHAPTERS.length,
      'Every chapter is accessible.',
    );
    assert(
      await page.getByRole('button', { name: 'Capítulo anterior' }).isDisabled(),
      'The first chapter has no previous chapter.',
    );
    const storyAxe = await new AxeBuilder({ page }).include('#game-dialog').analyze();
    assert(storyAxe.violations.length === 0, JSON.stringify(storyAxe.violations));
    await page.screenshot({ path: join(tmpdir(), `hex-story-${viewport.width}.png`) });
    const normalize = (text) => text.replace(/\s+/g, ' ').trim();
    for (const chapter of STORY_CHAPTERS) {
      await page.locator(`[data-story-chapter="${chapter.id}"]`).click();
      const article = page.locator(`#story-${chapter.id}`);
      assert(await article.isVisible(), 'Selected chapter must be visible.');
      const actual = await article.locator('.rules-copy > p').allTextContents();
      const expected = chapter.paragraphs.map((runs) => runs.map((run) => run.text).join(''));
      assert(
        actual.length === expected.length &&
          actual.every((p, i) => normalize(p) === normalize(expected[i])),
        `All paragraphs must be preserved for ${chapter.title}.`,
      );
      assert(
        await article.evaluate((element) => element.scrollWidth <= element.clientWidth),
        'Story must not overflow horizontally.',
      );
    }
    assert(
      await page.getByRole('button', { name: 'Capítulo siguiente' }).isDisabled(),
      'The final chapter has no next chapter.',
    );
    await page.getByRole('button', { name: 'Capítulo anterior' }).click();
    assert(
      await page.getByRole('heading', { name: STORY_CHAPTERS[8].title, exact: true }).isVisible(),
      'Previous chapter works.',
    );
    await page.getByRole('button', { name: 'Capítulo siguiente' }).click();
    assert(
      await page.locator('#story-chapter-10').evaluate((element) => element.scrollTop === 0),
      'Chapter starts at the top.',
    );
    const firstTab = page.locator('[data-story-chapter="chapter-1"]');
    await firstTab.focus();
    await firstTab.press(viewport.width <= 760 ? 'ArrowRight' : 'ArrowDown');
    await page.locator('#story-chapter-2').waitFor({ state: 'visible' });
    assert(
      (await page.locator('[data-story-chapter="chapter-2"]').getAttribute('aria-selected')) ===
        'true',
      'Keyboard chapter navigation works.',
    );
    await page.keyboard.press('Escape');
    assert(
      await page
        .locator('[data-home-action="story"]')
        .evaluate((element) => element === document.activeElement),
      'Closing returns focus to the story button.',
    );
    await page.locator('[data-home-action="new"]').click();
    await assertVisibleProfile();
    await profile.click();
    await page.locator('#profile-name').fill('Comandante Hex');
    await page.getByRole('radio', { name: 'Estrella' }).check();
    await page.getByRole('radio', { name: 'Ámbar', exact: true }).check();
    const result = await new AxeBuilder({ page }).include('#game-dialog').analyze();
    assert(result.violations.length === 0, JSON.stringify(result.violations));
    await page.screenshot({ path: join(tmpdir(), `hex-profile-${viewport.width}.png`) });
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert(
      (await profile.textContent()).includes('user'),
      'Cancel must preserve the original profile.',
    );
    await profile.click();
    await page.locator('#profile-name').fill('Comandante Hex');
    await page.getByRole('radio', { name: 'Estrella' }).check();
    await page.getByRole('radio', { name: 'Ámbar', exact: true }).check();
    await page.getByRole('button', { name: 'Guardar perfil' }).click();
    assert(
      (await profile.textContent()).includes('Comandante Hex'),
      'Saved profile appears in the second menu.',
    );
    await page.reload({ waitUntil: 'networkidle' });
    assert((await profile.textContent()).includes('Comandante Hex'), 'Profile survives reload.');
    assert((await profile.locator('.profile-amber').count()) === 1, 'Appearance survives reload.');
    await context.close();
  }
  console.log(
    'Home menu, ten story chapters, keyboard navigation, accessibility and profile passed at desktop and mobile sizes.',
  );
} finally {
  await browser?.close();
  await server.close();
}
