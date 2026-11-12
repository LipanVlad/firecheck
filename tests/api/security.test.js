import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { LOGIN_LIMIT } from '../../server/routes/auth.js';
import { startTestServer } from '../helpers.js';

let s;
before(async () => { s = await startTestServer(); });
after(() => s.close());

const login = (username, password) => s.api('POST', '/api/auth/login', { body: { username, password } });

test('T-SEC-01 antete de securitate pe toate răspunsurile, inclusiv CSP', async () => {
  const { headers } = await s.api('GET', '/api/health');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('x-powered-by'), null);
  const csp = headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
});

test('T-SEC-02 după 10 parole greșite, același cont primește 429; alt cont nu e afectat', async () => {
  for (let i = 0; i < LOGIN_LIMIT.maxFailures; i += 1) {
    assert.equal((await login('inspector2', 'gresit')).status, 401);
  }
  const blocked = await login('inspector2', 'gresit');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  // Blocat chiar și cu parola corectă, până expiră fereastra.
  assert.equal((await login('inspector2', 'insp123')).status, 429);
  // Alt cont, de la aceeași adresă, funcționează normal.
  assert.equal((await login('inspector3', 'insp123')).status, 200);
});

test('T-SEC-03 un login reușit resetează contorul de încercări', async () => {
  for (let i = 0; i < LOGIN_LIMIT.maxFailures - 1; i += 1) await login('inspector1', 'gresit');
  assert.equal((await login('inspector1', 'insp123')).status, 200);
  for (let i = 0; i < LOGIN_LIMIT.maxFailures - 1; i += 1) await login('inspector1', 'gresit');
  assert.equal((await login('inspector1', 'insp123')).status, 200);
});

test('T-SEC-04 timpul de răspuns nu dezvăluie dacă un cont există', async () => {
  const time = async (username) => {
    const start = performance.now();
    await login(username, 'parola-gresita');
    return performance.now() - start;
  };
  await time('coord'); // încălzire (hash-ul fals se calculează la primul apel)
  await time('nimeni-0');
  const existing = [];
  const missing = [];
  for (let i = 0; i < 4; i += 1) {
    existing.push(await time('coord'));
    missing.push(await time(`nimeni-${i + 1}`));
  }
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  // Ambele cazuri verifică un hash scrypt; fără protecție, contul inexistent ar fi de ~20× mai rapid.
  assert.ok(avg(missing) > avg(existing) * 0.5, `existent ${avg(existing).toFixed(1)} ms, inexistent ${avg(missing).toFixed(1)} ms`);
});

test('T-SEC-05 încercări pe multe conturi de la aceeași adresă: după 50 de eșecuri, 429 pentru orice cont', async () => {
  // Server separat: limita pe adresă ar bloca restul testelor din acest fișier.
  const own = await startTestServer({ seed: false });
  try {
    const attempt = (username) => own.api('POST', '/api/auth/login', { body: { username, password: 'gresit' } });
    for (let i = 0; i < LOGIN_LIMIT.maxFailuresPerIp; i += 1) {
      assert.equal((await attempt(`cont-${i}`)).status, 401);
    }
    const blocked = await attempt('alt-cont');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  } finally {
    await own.close();
  }
});
