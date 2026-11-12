import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestServer } from '../helpers.js';

let server;
before(async () => { server = await startTestServer(); });
after(async () => { await server.close(); });

test('GET /api/health răspunde 200 când baza de date e disponibilă', async () => {
  const response = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('x-request-id'));
  assert.deepEqual(await response.json(), { status: 'ok', db: 'ok' });
});

test('o rută API inexistentă întoarce 404 în formatul comun de eroare', async () => {
  const response = await fetch(`${server.baseUrl}/api/nu-exista`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('JSON invalid întoarce 400, nu 500', async () => {
  const response = await fetch(`${server.baseUrl}/api/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ nu e json'
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, 'VALIDATION_ERROR');
});

test('o eroare neașteptată întoarce 500 generic, fără detalii interne', async (t) => {
  // Server separat, a cărui bază de date o închidem intenționat ca să provocăm o eroare.
  const broken = await startTestServer();
  t.mock.method(console, 'error', () => {});
  await broken.db.sequelize.close();
  try {
    const response = await fetch(`${broken.baseUrl}/api/health`);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.deepEqual(body, { error: { code: 'INTERNAL_ERROR', message: 'Eroare internă' } });
  } finally {
    await broken.close({ dbAlreadyClosed: true });
  }
});
