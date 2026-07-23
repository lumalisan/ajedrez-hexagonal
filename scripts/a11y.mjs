import { existsSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const candidates =
  process.platform === 'win32'
    ? [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      ]
    : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium'];
const executablePath = process.env.PLAYWRIGHT_BROWSER_PATH || candidates.find(existsSync);
if (!executablePath) throw new Error('No browser found. Set PLAYWRIGHT_BROWSER_PATH.');

const server = await createServer({
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 4175, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4175', { waitUntil: 'networkidle' });
  await page.locator('[data-game-mode="local"]').click();
  await page.locator('[data-start-free]').click();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  if (serious.length) {
    const summary = serious
      .map(
        (violation) =>
          `${violation.id}: ${violation.help}\n${violation.nodes
            .map((node) => `  ${node.target.join(' ')} — ${node.failureSummary}`)
            .join('\n')}`,
      )
      .join('\n');
    throw new Error(`Accessibility violations:\n${summary}`);
  }
  console.log(`Axe passed: ${results.passes.length} rules, no serious or critical violations.`);
} finally {
  await browser.close();
  await server.close();
}
