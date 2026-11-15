import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices, expect, test } from '@playwright/test';
import { answer, answerAll, changeAnswer, coordApi, goOffline, goOnline, login, loginInspector, newInspection, unique } from './helpers.js';

// Pachetul OFF în browser (docs/packages/OFF.md). Durata offline se poate mări:
// OFFLINE_DURATION_MS=600000 npm run test:e2e   → 10 minute (T-OFF-07)
const OFFLINE_MS = Number(process.env.OFFLINE_DURATION_MS ?? 2000);

test('T-OFF-01/03/08 mod avion → editare + creare → reîncărcare → revenire online → sincronizare automată', async ({ page, context, request }) => {
  test.setTimeout(OFFLINE_MS + 90_000);
  await loginInspector(page, 'inspector1');

  await goOffline(context, page);
  const assignedCard = page.getByTestId('inspection-card').filter({ hasText: 'Asignată' }).first();
  const assignedLocation = await assignedCard.locator('strong').innerText();
  await assignedCard.click();
  await answer(page, 1, 'Conform');
  await page.getByRole('link', { name: '← Înapoi la listă' }).click();

  const location = unique('E2E offline nouă');
  await newInspection(page, location);

  // T-OFF-08: indicatorul arată offline și 2 modificări în așteptare.
  await expect(page.getByTestId('network-status')).toHaveText('Offline');
  await expect(page.getByTestId('pending-count')).toHaveText('2 nesincronizate');

  // T-OFF-01: reîncărcare fără rețea; aplicația vine din cache-ul service worker-ului.
  await page.reload();
  await expect(page.getByTestId('pending-count')).toHaveText('2 nesincronizate');
  await page.getByRole('link', { name: '← Înapoi la listă' }).click();
  await expect(page.getByTestId('inspection-card').filter({ hasText: location })).toBeVisible();

  await page.waitForTimeout(OFFLINE_MS);

  // T-OFF-03: la revenirea rețelei, sincronizarea pornește singură.
  await goOnline(context, page);
  await expect(page.getByTestId('pending-count')).toHaveText('0 nesincronizate', { timeout: 15_000 });

  const api = await coordApi(request);
  const created = await api.find(location);
  expect(created).toHaveLength(1);
  expect(created[0].answers.q1.value).toBe('fail');
  const edited = (await api.find(assignedLocation)).find((i) => i.status === 'in_progress' && i.answers.q1?.value === 'pass');
  expect(edited).toBeTruthy();
});

test('T-OFF-02 restart de browser offline: datele rămân și se sincronizează după reconectare', async ({ request, baseURL }) => {
  test.setTimeout(90_000);
  const profile = mkdtempSync(join(tmpdir(), 'firecheck-'));
  const options = { ...devices['Pixel 7'], baseURL, executablePath: process.env.CHROME_PATH };
  const location = unique('E2E restart');
  try {
    let context = await chromium.launchPersistentContext(profile, options);
    let page = context.pages()[0] ?? await context.newPage();
    await loginInspector(page, 'inspector2');
    await goOffline(context, page);
    await newInspection(page, location);
    await context.close();

    // Browserul pornește din nou, cu același profil, tot fără rețea.
    context = await chromium.launchPersistentContext(profile, options);
    await context.setOffline(true);
    page = context.pages()[0] ?? await context.newPage();
    await page.goto('/');
    await expect(page.getByTestId('pending-count')).toHaveText('1 nesincronizate');
    await expect(page.getByTestId('inspection-card').filter({ hasText: location })).toBeVisible();

    await goOnline(context, page);
    await expect(page.getByTestId('pending-count')).toHaveText('0 nesincronizate', { timeout: 15_000 });
    await context.close();

    expect(await (await coordApi(request)).find(location)).toHaveLength(1);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
});

test('T-OFF-04 retransmisie: răspunsul primului PUT se pierde, clientul reîncearcă, pe server rămâne 1 inspecție', async ({ browser, request, baseURL }) => {
  // Fără service worker, ca interceptarea cererilor să vadă direct cererile paginii.
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  let lost = 0;
  let puts = 0;
  await page.route('**/api/inspections/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    puts += 1;
    if (lost === 0) {
      lost += 1;
      await route.fetch(); // cererea ajunge la server și e salvată…
      return route.abort('connectionfailed'); // …dar răspunsul nu mai ajunge la client
    }
    return route.continue();
  });

  await login(page, 'inspector3');
  await expect(page.getByTestId('pending-count')).toHaveText('0 nesincronizate');
  const location = unique('E2E retransmisie');
  await newInspection(page, location);
  await expect(page.getByTestId('pending-count')).toHaveText('0 nesincronizate', { timeout: 15_000 });

  expect(lost).toBe(1);
  expect(puts).toBeGreaterThanOrEqual(2);
  expect(await (await coordApi(request)).find(location)).toHaveLength(1);
  // Răspunsul duplicat (applied=false, același marcaj de timp) nu e tratat ca un conflict.
  await expect(page.getByRole('status').filter({ hasText: 'variantă mai nouă' })).toHaveCount(0);
  await context.close();
});

test('T-OFF-05 conflict: două dispozitive editează offline aceeași inspecție; câștigă modificarea cea mai recentă', async ({ browser, request, baseURL }) => {
  const deviceA = await browser.newContext({ ...devices['Pixel 7'], baseURL });
  const deviceB = await browser.newContext({ ...devices['Pixel 7'], baseURL });
  const a = await deviceA.newPage();
  const b = await deviceB.newPage();
  await loginInspector(a, 'inspector2');
  await loginInspector(b, 'inspector2');

  const card = a.getByTestId('inspection-card').filter({ hasText: 'În lucru' }).first();
  const location = await card.locator('strong').innerText();
  await card.click();
  await b.getByTestId('inspection-card').filter({ hasText: location }).first().click();

  await goOffline(deviceA, a);
  await goOffline(deviceB, b);
  const fromB = await changeAnswer(b, 1); // B modifică primul…
  const fromA = await changeAnswer(a, 1, [fromB]); // …A modifică după, deci varianta lui A e cea mai recentă

  await goOnline(deviceA, a);
  await expect(a.getByTestId('pending-count')).toHaveText('0 nesincronizate', { timeout: 15_000 });
  await goOnline(deviceB, b);
  await expect(b.getByTestId('pending-count')).toHaveText('0 nesincronizate', { timeout: 15_000 });

  // B afișează varianta câștigătoare și explică ce s-a întâmplat.
  await expect(b.getByRole('status').filter({ hasText: 'variantă mai nouă' })).toBeVisible();
  await expect(b.getByRole('group', { name: /^1\./ }).getByRole('radio', { name: fromA, exact: true })).toBeChecked();

  const VALUES = { Conform: 'pass', Neconform: 'fail', 'N/A': 'na' };
  const [onServer] = await (await coordApi(request)).find(location);
  expect(onServer.answers.q1.value).toBe(VALUES[fromA]);
  await deviceA.close();
  await deviceB.close();
});

test('T-OFF-06 conflict cu blocarea: A trimite spre revizie, B (offline, date vechi) editează → B preia starea serverului', async ({ browser, request, baseURL }) => {
  const deviceA = await browser.newContext({ ...devices['Pixel 7'], baseURL });
  const deviceB = await browser.newContext({ ...devices['Pixel 7'], baseURL });
  const a = await deviceA.newPage();
  const b = await deviceB.newPage();
  await loginInspector(a, 'inspector3');
  await loginInspector(b, 'inspector3');

  const card = a.getByTestId('inspection-card').filter({ hasText: 'În lucru' }).first();
  const location = await card.locator('strong').innerText();
  await card.click();
  await b.getByTestId('inspection-card').filter({ hasText: location }).first().click();

  await goOffline(deviceB, b);
  await answerAll(a, 'Conform');
  await a.getByRole('button', { name: 'Trimite spre revizie' }).click();
  await expect(a.getByTestId('pending-count')).toHaveText('0 nesincronizate', { timeout: 15_000 });

  await changeAnswer(b, 1, ['Conform']);
  await goOnline(deviceB, b);
  await expect(b.getByTestId('pending-count')).toHaveText('0 nesincronizate', { timeout: 15_000 });
  await expect(b.getByRole('status').filter({ hasText: 'fusese deja trimisă' })).toBeVisible();
  await expect(b.getByText('Trimisă spre revizie').first()).toBeVisible();

  const [onServer] = await (await coordApi(request)).find(location);
  expect(onServer.status).toBe('submitted');
  expect(onServer.answers.q1.value).toBe('pass');
  await deviceA.close();
  await deviceB.close();
});

test('T-OFF-05b conflict în ordinea inversă: varianta veche ajunge prima, apoi cea nouă → dispozitivul vechi e anunțat', async ({ browser, request, baseURL }) => {
  test.setTimeout(90_000);
  const deviceA = await browser.newContext({ ...devices['Pixel 7'], baseURL });
  const deviceB = await browser.newContext({ ...devices['Pixel 7'], baseURL });
  const a = await deviceA.newPage();
  const b = await deviceB.newPage();
  await loginInspector(a, 'inspector1');
  await loginInspector(b, 'inspector1');

  const card = a.getByTestId('inspection-card').filter({ hasText: 'În lucru' }).first();
  const location = await card.locator('strong').innerText();
  await card.click();
  await b.getByTestId('inspection-card').filter({ hasText: location }).first().click();

  await goOffline(deviceA, a);
  await goOffline(deviceB, b);
  const fromB = await changeAnswer(b, 1); // B modifică primul (varianta mai veche)…
  const fromA = await changeAnswer(a, 1, [fromB]); // …A modifică după (varianta mai nouă)

  // B sincronizează primul: varianta lui e acceptată, fără conflict.
  await goOnline(deviceB, b);
  await expect(b.getByTestId('pending-count')).toHaveText('0 nesincronizate', { timeout: 15_000 });
  // A sincronizează după și o înlocuiește.
  await goOnline(deviceA, a);
  await expect(a.getByTestId('pending-count')).toHaveText('0 nesincronizate', { timeout: 15_000 });

  // Fără niciun click: B rămâne deschis online, iar sincronizarea periodică (la 30 s) îi aduce
  // varianta lui A, cu un mesaj care explică ce s-a întâmplat.
  await expect(b.getByRole('status').filter({ hasText: 'modificată ulterior de pe alt dispozitiv' })).toBeVisible({ timeout: 45_000 });
  await expect(b.getByRole('group', { name: /^1\./ }).getByRole('radio', { name: fromA, exact: true })).toBeChecked();

  const VALUES = { Conform: 'pass', Neconform: 'fail', 'N/A': 'na' };
  const [onServer] = await (await coordApi(request)).find(location);
  expect(onServer.answers.q1.value).toBe(VALUES[fromA]);
  await deviceA.close();
  await deviceB.close();
});

test('T-OFF-09 serverul nu răspunde deși browserul e online: timeout, reîncercări, apoi trimitere automată la revenire', async ({ browser, request, baseURL }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  let slow = true;
  let attempts = 0;
  // Semnal slab: cererile PUT „atârnă” mai mult decât timeout-ul clientului (5 s).
  await page.route('**/api/inspections/*', async (route) => {
    if (route.request().method() !== 'PUT' || !slow) return route.continue();
    attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 6000));
    return route.abort('timedout').catch(() => {});
  });

  await login(page, 'inspector2');
  await expect(page.getByTestId('pending-count')).toHaveText('0 nesincronizate');
  const location = unique('E2E semnal slab');
  await newInspection(page, location);

  // După 3 încercări cu timeout, modificarea rămâne în coadă și eroarea e afișată.
  await expect(page.getByText(/nu a răspuns în 5 s/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pending-count')).toHaveText('1 nesincronizate');
  expect(attempts).toBe(3);

  // Serverul răspunde din nou: reîncercarea periodică (la 30 s) o trimite fără nicio acțiune.
  slow = false;
  await expect(page.getByTestId('pending-count')).toHaveText('0 nesincronizate', { timeout: 45_000 });
  expect(await (await coordApi(request)).find(location)).toHaveLength(1);
  await context.close();
});

test('T-OFF-10 inspecție trimisă spre revizie offline: rămâne blocată până ajunge pe server', async ({ page, context, request }) => {
  await loginInspector(page, 'inspector2');
  const card = page.getByTestId('inspection-card').filter({ hasText: 'În lucru' }).first();
  const location = await card.locator('strong').innerText();
  await card.click();

  await goOffline(context, page);
  await answerAll(page, 'Conform');
  await page.getByRole('button', { name: 'Trimite spre revizie' }).click();
  await expect(page.getByTestId('pending-count')).toHaveText('1 nesincronizate');

  // Redeschisă offline: nu mai poate fi editată, deci o atingere nu o poate readuce „în lucru”.
  await page.getByRole('tab', { name: 'Trimise' }).click();
  await page.getByTestId('inspection-card').filter({ hasText: location }).click();
  await expect(page.getByText(/nu mai poate fi modificată \(se trimite la server/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Trimite spre revizie' })).toHaveCount(0);
  await expect(page.getByRole('group', { name: /^1\./ }).getByRole('radio', { name: 'Conform', exact: true })).toBeDisabled();

  await goOnline(context, page);
  await expect(page.getByTestId('pending-count')).toHaveText('0 nesincronizate', { timeout: 15_000 });
  const [onServer] = await (await coordApi(request)).find(location);
  expect(onServer.status).toBe('submitted');
});

test('T-OFF-11 al doilea tab pe același dispozitiv așteaptă; devine activ când primul se închide', async ({ context }) => {
  const first = await context.newPage();
  await first.goto('/');
  await expect(first.getByLabel('Utilizator')).toBeVisible();

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByTestId('other-tab')).toBeVisible();

  await first.close();
  await expect(second.getByLabel('Utilizator')).toBeVisible({ timeout: 15_000 });
});
