import { devices, expect, test } from '@playwright/test';
import { answerAll, login, loginInspector, unique } from './helpers.js';

test('T-E2E-01 coordonatorul asignează → inspectorul completează și trimite → coordonatorul aprobă → chitanța Registrului', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const location = unique('E2E flux complet');
  const office = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  const field = await browser.newContext({ ...devices['Pixel 7'], baseURL });
  const coord = await office.newPage();
  const insp = await field.newPage();

  // Coordonatorul asignează inspecția lui inspector1 (Andrei Popescu).
  await login(coord, 'coord');
  await coord.getByRole('link', { name: 'Asignare' }).first().click();
  await expect(coord.getByRole('heading', { level: 1, name: 'Asignare inspecție' })).toBeVisible();
  await coord.getByLabel('Inspector').selectOption({ label: 'Andrei Popescu' });
  await coord.getByLabel('Locație').fill(location);
  await coord.getByRole('button', { name: 'Asignează' }).click();
  await expect(coord.getByRole('status').filter({ hasText: 'a fost asignată' })).toBeVisible();

  // Inspectorul o vede, o completează și o trimite spre revizie.
  await loginInspector(insp, 'inspector1');
  await insp.getByTestId('inspection-card').filter({ hasText: location }).click();
  await insp.getByRole('button', { name: 'Trimite spre revizie' }).click();
  await expect(insp.getByText('Alege un răspuns.').first()).toBeVisible(); // validare: lipsesc răspunsuri
  await answerAll(insp, 'Conform');
  await insp.getByRole('button', { name: 'Trimite spre revizie' }).click();
  await expect(insp.getByTestId('pending-count')).toHaveText('0 nesincronizate', { timeout: 15_000 });
  await insp.getByRole('tab', { name: 'Trimise' }).click();
  await expect(insp.getByTestId('inspection-card').filter({ hasText: location })).toContainText('Trimisă spre revizie');

  // Coordonatorul o găsește, o aprobă și vede chitanța de la Registrul PSI.
  await coord.getByRole('link', { name: 'Inspecții' }).click();
  await coord.getByLabel('Caută în locație').fill(location);
  await coord.getByRole('button', { name: 'Caută' }).click();
  await coord.getByTestId('inspection-row').filter({ hasText: location }).click();
  await coord.getByRole('button', { name: 'Aprobă și trimite la Registru' }).click();
  await expect(coord.getByTestId('receipt')).toHaveText(/^PSI-2026-\d{6}$/, { timeout: 15_000 });
  await expect(coord.getByText('Aprobată').first()).toBeVisible();

  await office.close();
  await field.close();
});

test('T-E2E-02 interfața nu are derulare orizontală la 390 px și la 1280 px', async ({ browser, baseURL }) => {
  const noHorizontalScroll = async (page, label) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, label).toBeLessThanOrEqual(0);
  };

  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const context = await browser.newContext({ baseURL, viewport });
    const page = await context.newPage();

    await login(page, 'coord');
    for (const [link, heading] of [['Inspecții', 'Inspecții'], ['Asignare', 'Asignare inspecție'], ['Șabloane', 'Șabloane'], ['Raport', 'Raport central']]) {
      await page.getByRole('navigation', { name: 'Navigare principală' }).getByRole('link', { name: link }).click();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await noHorizontalScroll(page, `${viewport.width}px ${link}`);
    }
    await page.getByRole('button', { name: 'Ieșire' }).click();
    await expect(page.getByLabel('Utilizator')).toBeVisible(); // delogarea s-a încheiat

    await loginInspector(page, 'inspector2');
    await noHorizontalScroll(page, `${viewport.width}px Inspecțiile mele`);
    await page.getByTestId('inspection-card').first().click();
    await noHorizontalScroll(page, `${viewport.width}px formular`);
    await context.close();
  }
});
