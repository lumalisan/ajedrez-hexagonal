/** Interact with the visible select-only combobox and its accessible option list. */
export async function openSelect(page, label) {
  const combobox = page.getByRole('combobox', { name: label, exact: true });
  await combobox.scrollIntoViewIfNeeded();
  await combobox.focus();
  if ((await combobox.getAttribute('aria-expanded')) !== 'true') await combobox.press('ArrowDown');
  await page.getByRole('listbox').waitFor({ state: 'visible' });
  return combobox;
}

export async function chooseSelectOption(page, label, option) {
  await openSelect(page, label);
  await page.getByRole('option', { name: option, exact: true }).click();
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
}

export async function selectOptionLabels(page, label) {
  const combobox = await openSelect(page, label);
  const labels = await page.getByRole('option').evaluateAll((options) =>
    options.map((option) => {
      const content = option.cloneNode(true);
      content.querySelectorAll('[aria-hidden="true"]').forEach((element) => element.remove());
      return content.textContent.trim();
    }),
  );
  await combobox.press('Escape');
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  return labels;
}

export async function selectedOptionLabel(page, label) {
  const combobox = await openSelect(page, label);
  const text = await page.getByRole('option', { selected: true }).evaluate((option) => {
    const content = option.cloneNode(true);
    content.querySelectorAll('[aria-hidden="true"]').forEach((element) => element.remove());
    return content.textContent.trim();
  });
  await combobox.press('Escape');
  await page.getByRole('listbox').waitFor({ state: 'hidden' });
  return text?.trim();
}

export const INITIAL_LAYOUT_LABELS = {
  1: 'Frente clásico',
  2: 'Columnas de asedio',
  3: 'Frente blindado',
  4: 'Frente de infantería',
  5: 'Frente extendido',
};
