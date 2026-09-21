import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// Delivery encoding only: artwork is generated with ImageGen and retained unchanged as PNG.
const originals = new URL('../assets/achievements/originals/', import.meta.url);
const output = new URL('../public/achievements/', import.meta.url);
const candidates =
  process.platform === 'win32'
    ? [
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
      ]
    : [
        '/usr/bin/microsoft-edge',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ];
const executablePath = process.env.PLAYWRIGHT_BROWSER_PATH || candidates.find(existsSync);
if (!executablePath) throw new Error('Set PLAYWRIGHT_BROWSER_PATH to Chrome or Edge.');

await mkdir(output, { recursive: true });
const names = (await readdir(originals)).filter((name) => name.endsWith('.png')).sort();
if (names.length !== 28)
  throw new Error(`Expected 28 original achievement illustrations, found ${names.length}.`);
const browser = await chromium.launch({ executablePath, headless: true });
let originalBytes = 0;
let webBytes = 0;
try {
  const page = await browser.newPage();
  for (const name of names) {
    const source = await readFile(new URL(name, originals));
    const encoded = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      if (image.naturalWidth !== image.naturalHeight) throw new Error('Original must be square.');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas encoding is unavailable.');
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, 512, 512);
      const result = canvas.toDataURL('image/webp', 0.92);
      if (!result.startsWith('data:image/webp;')) throw new Error('WebP encoding is unavailable.');
      return result.split(',')[1];
    }, source.toString('base64'));
    const webp = Buffer.from(encoded, 'base64');
    await writeFile(new URL(name.replace(/\.png$/, '.webp'), output), webp);
    originalBytes += source.length;
    webBytes += webp.length;
  }
} finally {
  await browser.close();
}
console.log(`${names.length} square WebP assets written to ${fileURLToPath(output)}.`);
console.log(
  `Originals: ${(originalBytes / 1024 / 1024).toFixed(1)} MiB; delivery: ${(webBytes / 1024 / 1024).toFixed(1)} MiB.`,
);
