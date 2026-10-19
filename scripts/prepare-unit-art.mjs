import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Delivery encoding only; retain the generated references unchanged.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const root = new URL('../assets/units/', import.meta.url);
const output = new URL('../public/units/', import.meta.url);
const { units } = JSON.parse(await readFile(new URL('generation.json', root), 'utf8'));
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
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  for (const { type, original } of units) {
    const source = await readFile(new URL(original, root));
    const encoded = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 768;
      canvas.height = 512;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas encoding is unavailable.');
      context.fillStyle = '#222222';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(
        canvas.width / image.naturalWidth,
        canvas.height / image.naturalHeight,
      );
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.imageSmoothingQuality = 'high';
      context.drawImage(
        image,
        (canvas.width - width) / 2,
        (canvas.height - height) / 2,
        width,
        height,
      );
      const result = canvas.toDataURL('image/webp', 0.9);
      if (!result.startsWith('data:image/webp;')) throw new Error('WebP encoding is unavailable.');
      return result.split(',')[1];
    }, source.toString('base64'));
    await writeFile(new URL(`${type}.webp`, output), Buffer.from(encoded, 'base64'));
  }
} finally {
  await browser.close();
}
console.log(`${units.length} unit references encoded.`);
