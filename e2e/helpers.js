import { expect } from '@playwright/test';

export const PASSWORDS = { coord: 'coord123', inspector1: 'insp123', inspector2: 'insp123', inspector3: 'insp123' };

export async function login(page, username) {
  await page.goto('/');
  await page.getByLabel('Utilizator').fill(username);
  await page.getByLabel('Parolă').fill(PASSWORDS[username]);
  await page.getByRole('button', { name: 'Intră în cont' }).click();
  await expect(page.getByRole('button', { name: 'Ieșire' })).toBeVisible();
}

// Inspectorul: după login, așteaptă prima sincronizare și controlul service worker-ului.
export async function loginInspector(page, username) {
  await login(page, username);
  await expect(page.getByTestId('inspection-card').first()).toBeVisible();
  await expect(page.getByTestId('pending-count')).toHaveText('0 nesincronizate');
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined);
}

export async function goOffline(context, page) {
  await context.setOffline(true);
  await expect(page.getByTestId('network-status')).toHaveText('Offline');
}

export async function goOnline(context, page) {
  await context.setOffline(false);
  await expect(page.getByTestId('network-status')).toHaveText('Online');
}

// Răspunde la întrebarea cu numărul dat (1, 2, …) și așteaptă salvarea locală.
export async function answer(page, number, label) {
  await page.getByRole('group', { name: new RegExp(`^${number}\\.`) }).getByText(label, { exact: true }).click();
  await page.waitForTimeout(600);
}

// Alege la întrebarea dată un răspuns diferit de cel curent (și de cele din `avoid`).
// Un click pe răspunsul deja ales nu e o modificare, deci nu s-ar salva nimic.
export async function changeAnswer(page, number, avoid = []) {
  const group = page.getByRole('group', { name: new RegExp(`^${number}\\.`) });
  for (const label of ['Conform', 'Neconform', 'N/A']) {
    if (avoid.includes(label) || (await group.getByRole('radio', { name: label, exact: true }).isChecked())) continue;
    await group.getByText(label, { exact: true }).click();
    await page.waitForTimeout(600);
    return label;
  }
  throw new Error('niciun răspuns disponibil');
}

export async function answerAll(page, label = 'Conform') {
  const count = await page.getByRole('group').count();
  for (let n = 1; n <= count; n += 1) {
    await page.getByRole('group', { name: new RegExp(`^${n}\\.`) }).getByText(label, { exact: true }).click();
  }
  await page.waitForTimeout(600);
}

export async function newInspection(page, location) {
  await page.getByRole('link', { name: '+ Inspecție nouă' }).click();
  await page.getByLabel('Locație').fill(location);
  await answer(page, 1, 'Neconform');
  await expect(page).toHaveURL(/\/inspectii\/[0-9a-f-]{36}$/);
}

// Verificări direct pe API, ca un client separat (nu e afectat de modul offline al browserului).
export async function coordApi(request) {
  const response = await request.post('/api/auth/login', { data: { username: 'coord', password: 'coord123' } });
  const { token } = await response.json();
  const headers = { Authorization: `Bearer ${token}` };
  return {
    async find(q) {
      const page = await (await request.get(`/api/inspections?pageSize=100&q=${encodeURIComponent(q)}`, { headers })).json();
      return page.items;
    },
    async get(id) {
      return (await request.get(`/api/inspections/${id}`, { headers })).json();
    }
  };
}

export const unique = (label) => `${label} ${Date.now().toString(36)}`;
