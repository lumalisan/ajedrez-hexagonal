import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { RULE_SECTIONS } from '../src/rules-content.ts';
import { STORY_CHAPTERS } from '../src/story-content.ts';

const executablePath =
  process.env.PLAYWRIGHT_BROWSER_PATH ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find(existsSync);
assert(executablePath, 'Set PLAYWRIGHT_BROWSER_PATH to Chrome or Edge.');
const server = await createServer({
  logLevel: 'silent',
  cacheDir: 'node_modules/.vite-reading-smoke',
  server: { host: '127.0.0.1', port: 4178, strictPort: true, hmr: false },
});
await server.listen();
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:4178', { waitUntil: 'networkidle' });
    await page.locator('[data-home-action="rules"]').click();
    const article = page.locator('#rules-article');
    const checkOverflow = async () =>
      assert(await article.evaluate((e) => e.scrollWidth <= e.clientWidth));
    for (const id of ['descripcion', 'soldado', 'casillas-compartidas']) {
      await page.locator(`[data-rule-section="${id}"]`).click();
      await checkOverflow();
      if (id === 'descripcion') {
        assert(
          await article.locator('.rules-copy').evaluate((e) => {
            const outer = e.closest('.rules-article');
            return (
              Math.abs(
                e.getBoundingClientRect().right -
                  (outer.getBoundingClientRect().right -
                    parseFloat(getComputedStyle(outer).paddingRight)),
              ) < 3
            );
          }),
          'Text uses the full article width.',
        );
      } else {
        const canvas = article.locator('canvas[data-renderer-status="ready"]');
        await canvas.waitFor();
        assert(
          await article.evaluate((e) => {
            const copy = e.querySelector('.rules-copy').getBoundingClientRect();
            const demo = e.querySelector('.rule-demo').getBoundingClientRect();
            return (
              demo.top >= copy.bottom &&
              Math.abs((copy.left + copy.right - demo.left - demo.right) / 2) < 2
            );
          }),
          'Animation is below and centered on its text.',
        );
      }
      if (viewport.width > 760) {
        assert(
          await page.locator('[data-rule-section]').evaluateAll((tabs) =>
            tabs.every((tab) => {
              const range = document.createRange();
              range.selectNodeContents(tab);
              return (
                range.getBoundingClientRect().height <=
                parseFloat(getComputedStyle(tab).lineHeight) + 1
              );
            }),
          ),
          'Every section title fits on one line.',
        );
      }
      await page.screenshot({ path: join(tmpdir(), `hex-reading-${id}-${viewport.width}.png`) });
      if (id !== 'descripcion') {
        await article.locator('.rule-demo').scrollIntoViewIfNeeded();
        await page.screenshot({
          path: join(tmpdir(), `hex-reading-demo-${id}-${viewport.width}.png`),
        });
      }
    }
    for (const section of RULE_SECTIONS) {
      await page.locator(`[data-rule-section="${section.id}"]`).click();
      await checkOverflow();
      const actual = (await article.textContent()).replace(/\s+/g, ' ');
      for (const p of section.paragraphs) {
        if (typeof p !== 'string' && p.kind === 'table') continue;
        assert(
          actual.includes((typeof p === 'string' ? p : p.text).replace(/\s+/g, ' ')),
          `Preserve ${section.id} copy.`,
        );
      }
    }
    await page.locator('.rules-close').click();
    await page.locator('[data-home-action="story"]').click();
    for (const chapter of STORY_CHAPTERS) {
      await page.locator(`[data-story-chapter="${chapter.id}"]`).click();
      const content = page.locator('.story-article:visible');
      await content.locator('img').evaluate((e) => e.decode());
      assert(
        await content.evaluate((e) => e.scrollWidth <= e.clientWidth),
        'Story has no horizontal overflow.',
      );
      const text = await content.locator('.rules-copy > p').allTextContents();
      assert.deepEqual(
        text,
        chapter.paragraphs.map((p) => p.map((run) => run.text).join('')),
      );
      if (chapter.id === STORY_CHAPTERS[0].id) {
        await page.screenshot({ path: join(tmpdir(), `hex-reading-story-${viewport.width}.png`) });
        if (viewport.width > 760) {
          assert(
            await content.evaluate((e) => {
              const image = e.querySelector('img').getBoundingClientRect();
              const paragraphs = [...e.querySelectorAll('.rules-copy > p')];
              const lines = paragraphs.flatMap((p) => {
                const range = document.createRange();
                range.selectNodeContents(p);
                return [...range.getClientRects()];
              });
              return (
                lines.some((r) => r.top < image.bottom && r.right <= image.left) &&
                lines.some((r) => r.top > image.bottom && r.right > image.left)
              );
            }),
            'Story text wraps beside and then below the image.',
          );
        }
      }
    }
    await page.close();
  }
  console.log('Reading layouts and complete copy passed on desktop and mobile.');
} finally {
  await browser?.close();
  await server.close();
}
