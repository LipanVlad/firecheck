import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { inspectionBody, newId, startTestServer } from '../helpers.js';

let s;
let coord;
let insp1;
let insp2;
let ownId;
let otherId;

before(async () => {
  s = await startTestServer();
  coord = await s.login('coord');
  insp1 = await s.login('inspector1');
  insp2 = await s.login('inspector2');
  const [i1, i2] = s.data.inspectors;
  ownId = (await s.db.models.Inspection.findOne({ where: { inspectorId: i1.id } })).id;
  otherId = (await s.db.models.Inspection.findOne({ where: { inspectorId: i2.id } })).id;
});
after(() => s.close());

describe('autentificare', () => {
  test('T-AUTH-01 login cu date corecte întoarce token și utilizator, fără parolă', async () => {
    const { status, body } = await s.api('POST', '/api/auth/login', { body: { username: 'inspector1', password: 'insp123' } });
    assert.equal(status, 200);
    assert.ok(body.token.length >= 40);
    assert.deepEqual(Object.keys(body.user).sort(), ['fullName', 'id', 'role', 'username']);
  });

  test('T-AUTH-02 parolă greșită și utilizator inexistent primesc același răspuns', async () => {
    const a = await s.api('POST', '/api/auth/login', { body: { username: 'inspector1', password: 'gresit' } });
    const b = await s.api('POST', '/api/auth/login', { body: { username: 'nimeni', password: 'gresit' } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.deepEqual(a.body, b.body);
  });

  test('login fără câmpuri obligatorii → 400', async () => {
    const { status } = await s.api('POST', '/api/auth/login', { body: { username: 'coord' } });
    assert.equal(status, 400);
  });

  test('T-AUTH-03 fără token sau cu token invalid → 401', async () => {
    assert.equal((await s.api('GET', '/api/me')).status, 401);
    assert.equal((await s.api('GET', '/api/me', { token: 'inventat' })).status, 401);
    assert.equal((await s.api('GET', '/api/me', { headers: { Authorization: 'Basic abc' } })).status, 401);
  });

  test('GET /api/me întoarce utilizatorul tokenului', async () => {
    const { status, body } = await s.api('GET', '/api/me', { token: insp1 });
    assert.equal(status, 200);
    assert.equal(body.username, 'inspector1');
  });

  test('T-AUTH-04 token expirat → 401', async () => {
    const token = await s.login('inspector3');
    await s.db.models.Session.update({ expiresAt: new Date(Date.now() - 1000) }, { where: {} });
    assert.equal((await s.api('GET', '/api/me', { token })).status, 401);
    // Sesiunile celorlalți au fost expirate și ele; le refacem pentru testele următoare.
    coord = await s.login('coord');
    insp1 = await s.login('inspector1');
    insp2 = await s.login('inspector2');
  });

  test('T-AUTH-05 după logout, tokenul nu mai funcționează', async () => {
    const token = await s.login('inspector3');
    assert.equal((await s.api('POST', '/api/auth/logout', { token })).status, 204);
    assert.equal((await s.api('GET', '/api/me', { token })).status, 401);
  });

  test('T-AUTH-07 răspunsurile nu conțin parola sau hash-ul ei', async () => {
    const login = await s.api('POST', '/api/auth/login', { body: { username: 'coord', password: 'coord123' } });
    const me = await s.api('GET', '/api/me', { token: login.body.token });
    for (const text of [JSON.stringify(login.body), JSON.stringify(me.body)]) {
      assert.ok(!text.includes('coord123'));
      assert.ok(!text.includes('scrypt$'));
      assert.ok(!text.toLowerCase().includes('password'));
    }
  });
});

describe('permisiuni (R5)', () => {
  test('T-PERM-01 inspectorul nu poate crea șabloane', async () => {
    const { status } = await s.api('POST', '/api/templates', { token: insp1, body: { name: 'Test', questions: ['Întrebare?'] } });
    assert.equal(status, 403);
  });

  test('T-PERM-02 inspectorul nu poate crea asignări', async () => {
    const { status } = await s.api('POST', '/api/inspections', { token: insp1, body: { templateId: 1, inspectorId: s.data.inspectors[0].id, location: 'Bloc A' } });
    assert.equal(status, 403);
  });

  test('T-PERM-03 inspectorul nu poate aproba sau returna', async () => {
    const { status } = await s.api('POST', `/api/inspections/${ownId}/review`, { token: insp1, body: { decision: 'approve' } });
    assert.equal(status, 403);
  });

  test('T-PERM-04 inspectorul nu poate vedea raportul', async () => {
    assert.equal((await s.api('GET', '/api/report', { token: insp1 })).status, 403);
  });

  test('T-PERM-05 coordonatorul nu poate completa inspecții', async () => {
    const { status } = await s.api('PUT', `/api/inspections/${newId()}`, { token: coord, body: inspectionBody() });
    assert.equal(status, 403);
  });

  test('T-PERM-06 inspectorul nu poate reîncerca trimiterea la Registru', async () => {
    assert.equal((await s.api('POST', `/api/inspections/${ownId}/registry/retry`, { token: insp1 })).status, 403);
  });

  test('T-PERM-07 doar coordonatorul vede lista inspectorilor; lista nu conține date sensibile', async () => {
    assert.equal((await s.api('GET', '/api/users', { token: insp1 })).status, 403);
    const { status, body } = await s.api('GET', '/api/users', { token: coord });
    assert.equal(status, 200);
    assert.deepEqual(body.map((u) => u.username).sort(), ['inspector1', 'inspector2', 'inspector3']);
    assert.ok(body.every((u) => u.role === 'inspector' && !('passwordHash' in u)));
  });

  test('coordonatorul vede inspecțiile tuturor inspectorilor', async () => {
    const { body } = await s.api('GET', '/api/inspections?pageSize=100', { token: coord });
    assert.equal(body.total, 40);
    assert.equal(new Set(body.items.map((i) => i.inspectorId)).size, 3);
  });
});

describe('confidențialitate (R4)', () => {
  test('T-PRIV-01 inspectorul vede doar inspecțiile proprii, chiar dacă cere inspectorId altcuiva', async () => {
    const other = s.data.inspectors[1].id;
    const { body } = await s.api('GET', `/api/inspections?pageSize=100&inspectorId=${other}`, { token: insp1 });
    assert.ok(body.total > 0);
    assert.ok(body.items.every((i) => i.inspectorId === s.data.inspectors[0].id));
  });

  test('T-PRIV-02 detaliile inspecției altcuiva → 404', async () => {
    assert.equal((await s.api('GET', `/api/inspections/${otherId}`, { token: insp1 })).status, 404);
    assert.equal((await s.api('GET', `/api/inspections/${otherId}`, { token: insp2 })).status, 200);
  });

  test('T-PRIV-03 PUT pe inspecția altcuiva → 404, iar datele ei rămân neschimbate', async () => {
    const before = (await s.db.models.Inspection.findByPk(otherId)).toJSON();
    const body = inspectionBody({ templateId: before.templateId, clientUpdatedAt: new Date().toISOString() });
    const { status } = await s.api('PUT', `/api/inspections/${otherId}`, { token: insp1, body });
    assert.equal(status, 404);
    const afterRow = (await s.db.models.Inspection.findByPk(otherId)).toJSON();
    assert.deepEqual(afterRow, before);
  });
});
