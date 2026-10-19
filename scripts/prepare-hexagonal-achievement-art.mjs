import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Delivery encoding only. Generated PNG originals remain untouched.
const root = new URL('../assets/achievements/hexagonal/', import.meta.url);
const output = new URL('../public/achievements/hexagonal/', import.meta.url);
const { images } = JSON.parse(await readFile(new URL('generation.json', root), 'utf8'));
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
if (!executablePath) throw new Error('Set PLAYWRIGHT_BROWSER_PATH to Chrome or Edge.');
if (images.length !== 100 || new Set(images.map(({ id }) => id)).size !== 100)
  throw new Error('Expected 100 distinct achievement illustrations.');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
let bytes = 0;
try {
  const page = await browser.newPage();
  for (const { id, original } of images) {
    const source = await readFile(new URL(original, root));
    const encoded = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 400;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas encoding is unavailable.');
      const scale = Math.min(512 / image.naturalWidth, 400 / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, (512 - width) / 2, (400 - height) / 2, width, height);
      const result = canvas.toDataURL('image/webp', 0.9);
      if (!result.startsWith('data:image/webp;')) throw new Error('WebP encoding is unavailable.');
      return result.split(',')[1];
    }, source.toString('base64'));
    const webp = Buffer.from(encoded, 'base64');
    await writeFile(new URL(`${id}.webp`, output), webp);
    bytes += webp.length;
  }
} finally {
  await browser.close();
}
console.log(`100 horizontal WebP badges encoded: ${(bytes / 1024 / 1024).toFixed(1)} MiB.`);
