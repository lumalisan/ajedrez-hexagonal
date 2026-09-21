import assert from 'node:assert/strict';
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
    : [
        '/usr/bin/microsoft-edge',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ];
const executablePath = process.env.PLAYWRIGHT_BROWSER_PATH || candidates.find(existsSync);
assert(executablePath, 'No browser found. Set PLAYWRIGHT_BROWSER_PATH to Chrome or Edge.');

const server = await createServer({
  logLevel: 'silent',
  server: { host: '127.0.0.1', port: 4176, strictPort: true },
});
await server.listen();
let browser;

try {
  browser = await chromium.launch({ executablePath, headless: true });
  const scans = [];
  const runtimeErrors = [];

  for (const profile of [
    { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false },
    { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true },
  ]) {
    const context = await browser.newContext({
      viewport: profile.viewport,
      isMobile: profile.isMobile,
      hasTouch: profile.isMobile,
      reducedMotion: 'reduce',
    });

    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => runtimeErrors.push(`${profile.name}: ${error.message}`));
      const audit = async (state) => {
        const results = await new AxeBuilder({ page }).analyze();
        scans.push({ label: `${profile.name} / ${state}`, results });
        console.log(`Axe scanned: ${profile.name} / ${state}, ${results.passes.length} checks.`);
      };
      const screenshot = async (state) => {
        if (process.env.DS_SCREENSHOT) {
          await page.screenshot({
            path: `${process.env.DS_SCREENSHOT}-${profile.name}-${state}.png`,
            fullPage: true,
          });
        }
      };

      await page.goto('http://127.0.0.1:4176/design-system.html', { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Sistema de diseño', exact: true }).waitFor();
      await assertNoOverflow(page, profile.name);
      await assertAccessibleReferences(page);
      await audit('normal');
      await screenshot('normal');

      const input = page.getByRole('textbox', { name: 'Nombre de la partida (obligatorio)' });
      const submit = page.getByRole('button', { name: 'Validar formulario', exact: true });
      const review = page.getByRole('button', { name: 'Revisar nombre', exact: true });
      await review.click();
      await assertFocused(
        page,
        input,
        'The form action must forward its input ref and focus the name.',
      );
      assert.equal(
        await page.getByRole('alert').count(),
        0,
        'A default button must not submit its form.',
      );

      await submit.click();
      await assertFocused(
        page,
        input,
        'Invalid submission must focus the field needing correction.',
      );
      await waitForAttribute(page, input, 'aria-invalid', 'true');
      const error = page.getByRole('alert');
      assert.match(await error.innerText(), /Escribe un nombre/);
      const errorId = await error.getAttribute('id');
      const descriptions = (await input.getAttribute('aria-describedby')).split(/\s+/);
      assert(
        descriptions.includes(errorId),
        'The invalid input must reference its visible correction.',
      );
      assert(
        descriptions.includes('sample-name-external'),
        'External help must survive the addition of field descriptions and validation errors.',
      );
      assert.equal(
        await input.getAttribute('required'),
        '',
        'The field must preserve required semantics.',
      );
      await assertAccessibleReferences(page);
      await audit('validation error');
      await screenshot('error');

      await input.fill('Defensa de la Fortaleza');
      await error.waitFor({ state: 'detached' });
      assert.notEqual(
        await input.getAttribute('aria-invalid'),
        'true',
        'Correcting input must clear invalid state.',
      );
      assert(
        !(await input.getAttribute('aria-describedby')).split(/\s+/).includes(errorId),
        'Removing an error must also remove its accessible reference.',
      );
      await assertAccessibleReferences(page);
      await submit.click();
      assert.match(await page.getByRole('status').innerText(), /Cambios guardados/);
      await page.getByRole('button', { name: 'Editar nombre', exact: true }).click();
      await assertFocused(page, input, 'Native input refs must work through FieldControl.');

      const partial = page.getByRole('checkbox', { name: 'Selección parcial', exact: true });
      assert.equal(await partial.getAttribute('aria-checked'), 'mixed');
      const touchTarget = await partial.boundingBox();
      assert(
        touchTarget.width >= 44 && touchTarget.height >= 44,
        'Checkbox targets must be at least 44px.',
      );
      await partial.focus();
      await page.keyboard.press('Space');
      await waitForAttribute(page, partial, 'aria-checked', 'true');
      await page.keyboard.press('Space');
      await waitForAttribute(page, partial, 'aria-checked', 'false');
      await page.getByText('Selección parcial', { exact: true }).click();
      await waitForAttribute(page, partial, 'aria-checked', 'true');

      const local = page.getByRole('radio', { name: 'Dos jugadores', exact: true });
      const machine = page.getByRole('radio', { name: 'Individual vs. IA', exact: true });
      const online = page.getByRole('radio', { name: 'En línea · no disponible', exact: true });
      assert(await online.isDisabled(), 'Unavailable radio choices must be disabled.');
      await local.focus();
      // Radix moves focus asynchronously; hold the key until that focus event selects the item.
      await page.keyboard.down('ArrowRight');
      await assertFocused(page, machine, 'Arrow keys must move focus within a radio group.');
      await waitForAttribute(page, machine, 'aria-checked', 'true');
      await page.keyboard.up('ArrowRight');
      await page.keyboard.down('ArrowRight');
      await assertFocused(page, local, 'Radio navigation must skip disabled choices and wrap.');
      await waitForAttribute(page, local, 'aria-checked', 'true');
      await page.keyboard.up('ArrowRight');

      const colorTab = page.getByRole('tab', { name: 'Color y forma', exact: true });
      const keyboardTab = page.getByRole('tab', { name: 'Teclado', exact: true });
      const futureTab = page.getByRole('tab', { name: 'Próximamente', exact: true });
      assert(await futureTab.isDisabled(), 'Unavailable tabs must be disabled.');
      await colorTab.focus();
      await page.keyboard.press('ArrowRight');
      await assertFocused(page, keyboardTab, 'Arrow keys must move to and activate the next tab.');
      await waitForAttribute(page, keyboardTab, 'aria-selected', 'true');
      await page.keyboard.press('ArrowRight');
      await assertFocused(page, colorTab, 'Tab navigation must skip disabled triggers and wrap.');
      await page.keyboard.press('End');
      await assertFocused(page, keyboardTab, 'End must focus the last enabled tab.');
      await page.keyboard.press('Tab');
      await assertFocused(
        page,
        page.getByRole('tabpanel', { name: 'Teclado', exact: true }),
        'Tab must move from the tab list to its active panel.',
      );

      for (const name of ['Sin partida guardada', 'Guardando partida']) {
        const button = page.getByRole('button', { name, exact: true });
        assert(await button.isDisabled(), `${name} must prevent interaction.`);
        const clicks = await button.evaluate((element) => {
          let count = 0;
          element.addEventListener('click', () => count++, { once: true });
          element.click();
          return count;
        });
        assert.equal(clicks, 0, `${name} must not dispatch activation while disabled.`);
      }
      assert.equal(
        await page
          .getByRole('button', { name: 'Guardando partida', exact: true })
          .getAttribute('aria-busy'),
        'true',
        'Loading actions must expose their busy state.',
      );

      const contrast = page.getByRole('checkbox', { name: 'Alto contraste', exact: true });
      await contrast.focus();
      await page.keyboard.press('Space');
      await waitForAttribute(page, contrast, 'aria-checked', 'true');
      await page.waitForFunction(() =>
        document.documentElement.classList.contains('high-contrast'),
      );
      await assertNoOverflow(page, `${profile.name} high contrast`);
      await audit('high contrast');
      await screenshot('high-contrast');

      assert(
        await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
        'The browser profile must exercise the system reduced-motion preference.',
      );
      const motionViolations = await page
        .locator('.ds-control, .ds-input, .ds-textarea, .ds-checkbox')
        .evaluateAll((elements) =>
          elements
            .filter((element) => {
              const style = getComputedStyle(element);
              // The game retains a 0.01ms duration so existing transitionend handlers still fire.
              const hasMotion = (durations) =>
                durations
                  .split(',')
                  .some(
                    (duration) =>
                      parseFloat(duration) * (duration.trim().endsWith('ms') ? 1 : 1000) > 1,
                  );
              return (
                (style.transitionProperty !== 'none' && hasMotion(style.transitionDuration)) ||
                (style.animationName !== 'none' && hasMotion(style.animationDuration))
              );
            })
            .map((element) => element.textContent || element.id),
        );
      assert.deepEqual(
        motionViolations,
        [],
        'System reduced motion must disable control animations.',
      );

      await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
      const indicatorVisible = await partial.locator('svg').evaluate((svg) => {
        const style = getComputedStyle(svg);
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          Number(style.opacity) > 0 &&
          style.stroke !== 'none' &&
          [...svg.querySelectorAll('path')].some((path) => {
            const bounds = path.getBoundingClientRect();
            return getComputedStyle(path).display !== 'none' && bounds.width > 0;
          })
        );
      });
      assert(indicatorVisible, 'Forced colors must keep the checked indicator visible.');
      await screenshot('forced-colors');
      console.log(`Design system interactions passed: ${profile.name}.`);
    } finally {
      await context.close();
    }
  }

  assert.deepEqual(runtimeErrors, [], 'The catalog must not produce browser runtime errors.');
  const violations = scans.flatMap(({ label, results }) =>
    results.violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map(
        (violation) =>
          `[${label}] ${violation.id}: ${violation.help}\n${violation.nodes.map((node) => `  ${node.target.join(' ')} — ${node.failureSummary}`).join('\n')}`,
      ),
  );
  assert.deepEqual(
    violations,
    [],
    'The design system must have no serious or critical Axe violations.',
  );
  console.log(`Design system passed: desktop and mobile interactions, ${scans.length} Axe scans.`);
} finally {
  await browser?.close();
  await server.close();
}

async function assertFocused(page, locator, message) {
  const element = await locator.elementHandle();
  try {
    await page.waitForFunction((target) => document.activeElement === target, element);
  } catch {
    assert.fail(message);
  } finally {
    await element.dispose();
  }
}

async function waitForAttribute(page, locator, name, value) {
  const element = await locator.elementHandle();
  try {
    await page.waitForFunction(
      ({ target, attribute, expected }) => target.getAttribute(attribute) === expected,
      { target: element, attribute: name, expected: value },
    );
  } finally {
    await element.dispose();
  }
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(
    () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
  );
  assert(
    overflow <= 1,
    `${label} must fit horizontally without clipping or scrolling (${overflow}px).`,
  );
}

async function assertAccessibleReferences(page) {
  const issues = await page.evaluate(() => {
    const result = [];
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    if (new Set(ids).size !== ids.length) result.push('Duplicate IDs');
    for (const element of document.querySelectorAll('[aria-describedby]')) {
      for (const id of element.getAttribute('aria-describedby').split(/\s+/).filter(Boolean)) {
        if (!document.getElementById(id)) result.push(`Missing description: ${id}`);
      }
    }
    for (const element of document.querySelectorAll(
      'input:not([type="hidden"]), textarea, button[role="checkbox"]',
    )) {
      if (!element.getClientRects().length) continue;
      if (!element.labels?.length)
        result.push(`No associated visible label: ${element.id || element.tagName}`);
    }
    return result;
  });
  assert.deepEqual(
    issues,
    [],
    'Every visible field must have a native label and existing description targets.',
  );
}
