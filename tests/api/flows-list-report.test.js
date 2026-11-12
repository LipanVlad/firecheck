import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { at, fakePhoto, fullAnswers, inspectionBody, newId, startTestServer } from '../helpers.js';

let s;
let coord;
let insp;

before(async () => {
  s = await startTestServer();
  coord = await s.login('coord');
  insp = await s.login('inspector1');
});
after(() => s.close());

const list = (query, token = coord) => s.api('GET', `/api/inspections?${query}`, { token });

describe('filtrare, sortare, paginare (T-LIST)', () => {
  test('T-LIST-01 filtrare după status, inspector, text și termen', async () => {
    const byStatus = await list('status=approved&pageSize=100');
    assert.equal(byStatus.body.total, 8);
    assert.ok(byStatus.body.items.every((i) => i.status === 'approved'));

    const inspectorId = s.data.inspectors[1].id;
    const byInspector = await list(`inspectorId=${inspectorId}&pageSize=100`);
    assert.ok(byInspector.body.total > 0);
    assert.ok(byInspector.body.items.every((i) => i.inspectorId === inspectorId));

    const byText = await list('q=bloc&pageSize=100');
    assert.ok(byText.body.total > 0);
    // Fără diferență între litere mari și mici.
    assert.ok(byText.body.items.every((i) => i.location.toLowerCase().includes('bloc')));

    // Diacriticele se potrivesc exact (bug găsit de testele E2E: „Școala” nu era găsită).
    const scoala = await list('q=Școala&pageSize=100');
    assert.ok(scoala.body.total > 0);
    assert.ok(scoala.body.items.every((i) => i.location.includes('Școala')));

    // % și _ sunt căutate ca text, nu interpretate ca „orice caracter”.
    assert.equal((await list('q=%25%25&pageSize=100')).body.total, 0);
    assert.equal((await list('q=__&pageSize=100')).body.total, 0);

    const byDue = await list('dueBefore=2026-11-05&pageSize=100');
    assert.ok(byDue.body.total > 0);
    assert.ok(byDue.body.items.every((i) => i.dueDate <= '2026-11-05'));
  });

  test('T-LIST-02 sortare după fiecare câmp, în ambele sensuri', async () => {
    for (const [sort, field] of [['location', 'location'], ['dueDate', 'dueDate'], ['status', 'status'], ['updatedAt', 'updatedAt']]) {
      for (const order of ['asc', 'desc']) {
        const values = (await list(`sort=${sort}&order=${order}&pageSize=100`)).body.items.map((i) => i[field]);
        const expected = [...values].sort();
        if (order === 'desc') expected.reverse();
        assert.deepEqual(values, expected, `${sort} ${order}`);
      }
    }
  });

  test('T-LIST-03 paginare: 40 de inspecții, pageSize=15 → 3 pagini, fără repetări sau lipsuri', async () => {
    const pages = [];
    for (let page = 1; page <= 3; page += 1) pages.push((await list(`pageSize=15&page=${page}&sort=location`)).body);
    assert.deepEqual(pages.map((p) => p.items.length), [15, 15, 10]);
    assert.ok(pages.every((p) => p.total === 40 && p.totalPages === 3));
    const ids = pages.flatMap((p) => p.items.map((i) => i.id));
    assert.equal(new Set(ids).size, 40);
    const beyond = (await list('pageSize=15&page=4')).body;
    assert.deepEqual(beyond.items, []);
  });

  test('lista nu conține poze, doar numărul lor', async () => {
    const id = newId();
    const photo = fakePhoto(100);
    await s.api('PUT', `/api/inspections/${id}`, { token: insp, body: inspectionBody({ photos: [photo, photo] }) });
    const item = (await list('q=bloc z&pageSize=100')).body.items.find((i) => i.id === id);
    assert.equal(item.photoCount, 2);
    assert.equal(item.photos, undefined);
    const detail = await s.api('GET', `/api/inspections/${id}`, { token: insp });
    assert.equal(detail.body.photos.length, 2);
  });
});

describe('fluxuri complete', () => {
  test('T-FLOW-02 inspecția neplanificată apare la inspector și la coordonator', async () => {
    const id = newId();
    const created = await s.api('PUT', `/api/inspections/${id}`, { token: insp, body: inspectionBody({ location: 'Depozit nou, rampa 3' }) });
    assert.equal(created.status, 201);
    assert.equal(created.body.inspection.inspectorId, s.data.inspectors[0].id);
    const mine = await list('q=rampa 3', insp);
    const all = await list('q=rampa 3');
    assert.deepEqual(mine.body.items.map((i) => i.id), [id]);
    assert.deepEqual(all.body.items.map((i) => i.id), [id]);
  });

  test('T-REP-01 raportul reflectă statusurile și neconformitățile', async () => {
    const before = (await s.api('GET', '/api/report', { token: coord })).body;
    const id = newId();
    await s.api('PUT', `/api/inspections/${id}`, { token: insp, body: inspectionBody({ status: 'submitted', answers: fullAnswers(5, 'fail'), clientUpdatedAt: at(2) }) });
    const after = (await s.api('GET', '/api/report', { token: coord })).body;

    assert.equal(after.total, before.total + 1);
    assert.equal(after.byStatus.submitted, before.byStatus.submitted + 1);
    assert.equal(after.byInspector.reduce((sum, i) => sum + i.submitted, 0), after.byStatus.submitted);
    assert.ok(after.topNonConformities.every((n) => n.questionText));
    assert.equal(after.registry.sent, 8);

    const filtered = (await s.api('GET', `/api/report?inspectorId=${s.data.inspectors[2].id}&from=2026-01-01&to=2030-01-01`, { token: coord })).body;
    assert.equal(filtered.byInspector.length, 1);
    assert.ok(filtered.total < after.total);
  });

  test('T-DB-03 aprobarea și crearea trimiterii sunt atomice', async (t) => {
    t.mock.method(console, 'error', () => {});
    const id = newId();
    await s.api('PUT', `/api/inspections/${id}`, { token: insp, body: inspectionBody({ status: 'submitted', answers: fullAnswers(), clientUpdatedAt: at(2) }) });
    // O trimitere există deja (stare imposibilă în mod normal) → inserarea din aprobare eșuează (UNIQUE).
    await s.db.models.RegistrySubmission.create({ inspectionId: id, status: 'failed' });

    const { status } = await s.api('POST', `/api/inspections/${id}/review`, { token: coord, body: { decision: 'approve' } });
    assert.equal(status, 500);
    // Tranzacția a fost anulată: inspecția nu a rămas „approved”.
    assert.equal((await s.db.models.Inspection.findByPk(id)).status, 'submitted');
  });
});
