import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { at, fakePhoto, fullAnswers, inspectionBody, newId, startTestServer } from '../helpers.js';

let s;
let insp;
let coord;

before(async () => {
  s = await startTestServer();
  insp = await s.login('inspector1');
  coord = await s.login('coord');
});
after(() => s.close());

const put = (id, body) => s.api('PUT', `/api/inspections/${id}`, { token: insp, body });
const paths = (response) => response.body.error.details.map((d) => d.path);

test('T-VAL-02 ID care nu e UUID → 400', async () => {
  const response = await put('123', inspectionBody());
  assert.equal(response.status, 400);
  assert.deepEqual(paths(response), ['id']);
});

test('T-VAL-03 lipsesc templateId și location → 400 cu ambele câmpuri', async () => {
  const { templateId, location, ...rest } = inspectionBody();
  const response = await put(newId(), rest);
  assert.equal(response.status, 400);
  assert.deepEqual(paths(response).sort(), ['location', 'templateId']);
});

test('T-VAL-04 valoare de răspuns nepermisă → 400', async () => {
  const response = await put(newId(), inspectionBody({ answers: { q1: { value: 'poate' } } }));
  assert.equal(response.status, 400);
  assert.deepEqual(paths(response), ['answers.q1.value']);
});

test('T-VAL-05 răspuns la o întrebare care nu e în șablon → 400', async () => {
  const response = await put(newId(), inspectionBody({ answers: { q9: { value: 'pass' } } }));
  assert.equal(response.status, 400);
  assert.deepEqual(paths(response), ['answers.q9']);
});

test('T-VAL-06 prea multe poze, poză prea mare, tip nepermis, conținut fals → 400', async () => {
  const small = fakePhoto(100);
  assert.equal((await put(newId(), inspectionBody({ photos: [small, small, small, small] }))).status, 400);
  assert.deepEqual(paths(await put(newId(), inspectionBody({ photos: [fakePhoto(201 * 1024)] }))), ['photos.0']);
  assert.equal((await put(newId(), inspectionBody({ photos: ['data:image/gif;base64,R0lGOD'] }))).status, 400);
  // Declarată PNG, dar conținutul nu începe cu semnătura PNG.
  const fake = `data:image/png;base64,${Buffer.from('nu sunt o imagine').toString('base64')}`;
  const rejected = await put(newId(), inspectionBody({ photos: [fake] }));
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error.details[0].message, /nu e o imagine/);
  assert.equal((await put(newId(), inspectionBody({ photos: [small, fakePhoto(100, 'png')] }))).status, 201);
});

test('T-VAL-07 șablonul unei inspecții existente nu se poate schimba → 400', async () => {
  const id = newId();
  assert.equal((await put(id, inspectionBody({ clientUpdatedAt: at(10) }))).status, 201);
  const response = await put(id, inspectionBody({ templateId: 1, answers: {}, clientUpdatedAt: at(5) }));
  assert.equal(response.status, 400);
  assert.deepEqual(paths(response), ['templateId']);
});

test('șablon inexistent la creare → 400', async () => {
  const response = await put(newId(), inspectionBody({ templateId: 999 }));
  assert.equal(response.status, 400);
  assert.deepEqual(paths(response), ['templateId']);
});

test('T-VAL-08 clientUpdatedAt cu 10 minute în viitor → 400 (R8)', async () => {
  const future = new Date(Date.now() + 10 * 60_000).toISOString();
  const response = await put(newId(), inspectionBody({ clientUpdatedAt: future }));
  assert.equal(response.status, 400);
  assert.deepEqual(paths(response), ['clientUpdatedAt']);
});

test('inspectorul nu poate seta singur statusul approved sau assigned → 400', async () => {
  assert.equal((await put(newId(), inspectionBody({ status: 'approved', answers: fullAnswers() }))).status, 400);
  assert.equal((await put(newId(), inspectionBody({ status: 'assigned' }))).status, 400);
});

test('T-VAL-09 șablon fără întrebări sau cu nume prea scurt → 400', async () => {
  assert.equal((await s.api('POST', '/api/templates', { token: coord, body: { name: 'Ok nume', questions: [] } })).status, 400);
  assert.equal((await s.api('POST', '/api/templates', { token: coord, body: { name: 'A', questions: ['Întrebare?'] } })).status, 400);
});

test('coordonatorul creează un șablon valid; ID-urile întrebărilor sunt q1, q2', async () => {
  const { status, body } = await s.api('POST', '/api/templates', { token: coord, body: { name: 'Uși rezistente la foc', questions: ['Ușa se închide singură?', 'Garnitura e intactă?'] } });
  assert.equal(status, 201);
  assert.deepEqual(body.questions.map((q) => q.id), ['q1', 'q2']);
  const list = await s.api('GET', '/api/templates', { token: insp });
  assert.ok(list.body.some((t) => t.id === body.id));
});

test('T-VAL-10 corp peste 1 MB → 413', async () => {
  const huge = inspectionBody({ location: 'x'.repeat(1_100_000) });
  const response = await put(newId(), huge);
  assert.equal(response.status, 413);
  assert.equal(response.body.error.code, 'PAYLOAD_TOO_LARGE');
});

test('T-VAL-11 parametri de listare invalizi → 400', async () => {
  for (const query of ['sort=password', 'pageSize=1000', 'page=0', 'status=deleted', 'order=sideways', 'q=a']) {
    const { status } = await s.api('GET', `/api/inspections?${query}`, { token: coord });
    assert.equal(status, 400, query);
  }
});

test('asignare cu inspector inexistent sau cu un coordonator ca inspector → 400', async () => {
  const body = { templateId: 1, location: 'Bloc A, hol' };
  assert.equal((await s.api('POST', '/api/inspections', { token: coord, body: { ...body, inspectorId: 999 } })).status, 400);
  assert.equal((await s.api('POST', '/api/inspections', { token: coord, body: { ...body, inspectorId: s.data.coordinator.id } })).status, 400);
});

test('raport cu interval invalid (to înainte de from) → 400', async () => {
  const { status } = await s.api('GET', '/api/report?from=2026-11-10&to=2026-11-01', { token: coord });
  assert.equal(status, 400);
});

test('raport doar cu „to” sau doar cu „from” → 200', async () => {
  assert.equal((await s.api('GET', '/api/report?to=2030-01-01', { token: coord })).status, 200);
  assert.equal((await s.api('GET', '/api/report?from=2020-01-01', { token: coord })).status, 200);
});
