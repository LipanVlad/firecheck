import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { at, fullAnswers, inspectionBody, newId, startTestServer } from '../helpers.js';

// Regulile pe care se sprijină pachetul OFF: duplicate (R1), conflicte (R2), blocare (R3), stări (R6).

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
const rows = (id) => s.db.models.Inspection.count({ where: { id } });
const stored = async (id) => (await s.db.models.Inspection.findByPk(id)).toJSON();

describe('duplicate (R1)', () => {
  test('T-IDEM-01 același PUT de 5 ori, secvențial → 1 rând; 201 apoi 200 applied=false', async () => {
    const id = newId();
    const body = inspectionBody({ clientUpdatedAt: at(5) });
    const responses = [];
    for (let i = 0; i < 5; i += 1) responses.push(await put(id, body));

    assert.deepEqual(responses.map((r) => r.status), [201, 200, 200, 200, 200]);
    assert.deepEqual(responses.map((r) => r.body.applied), [true, false, false, false, false]);
    assert.equal(await rows(id), 1);
    // Toate răspunsurile descriu aceeași stare.
    assert.equal(new Set(responses.map((r) => JSON.stringify(r.body.inspection))).size, 1);
  });

  test('T-IDEM-02 același PUT de 5 ori simultan → 1 rând, niciun 500', async () => {
    const id = newId();
    const body = inspectionBody({ clientUpdatedAt: at(5) });
    const responses = await Promise.all(Array.from({ length: 5 }, () => put(id, body)));

    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 200, 200, 200, 201]);
    assert.equal(responses.filter((r) => r.body.applied).length, 1);
    assert.equal(await rows(id), 1);
  });
});

describe('conflicte: ultima modificare câștigă (R2)', () => {
  test('T-CONF-02 nou (t=10), apoi vechi (t=5) → rămâne cel nou', async () => {
    const id = newId();
    await put(id, inspectionBody({ location: 'Varianta nouă', clientUpdatedAt: at(1) }));
    const old = await put(id, inspectionBody({ location: 'Varianta veche', clientUpdatedAt: at(5) }));
    assert.equal(old.status, 200);
    assert.equal(old.body.applied, false);
    assert.equal(old.body.inspection.location, 'Varianta nouă');
    assert.equal((await stored(id)).location, 'Varianta nouă');
  });

  test('T-CONF-03 vechi (t=5), apoi nou (t=10) → rămâne cel nou', async () => {
    const id = newId();
    await put(id, inspectionBody({ location: 'Varianta veche', clientUpdatedAt: at(5) }));
    const fresh = await put(id, inspectionBody({ location: 'Varianta nouă', clientUpdatedAt: at(1) }));
    assert.equal(fresh.body.applied, true);
    assert.equal((await stored(id)).location, 'Varianta nouă');
  });

  test('T-CONF-04 același clientUpdatedAt, conținut diferit → rămâne primul', async () => {
    const id = newId();
    const time = at(3);
    await put(id, inspectionBody({ location: 'Primul', clientUpdatedAt: time }));
    const second = await put(id, inspectionBody({ location: 'Al doilea', clientUpdatedAt: time }));
    assert.equal(second.body.applied, false);
    assert.equal((await stored(id)).location, 'Primul');
  });
});

describe('fluxul cu stări și blocarea (R3, R6)', () => {
  test('T-STATE-03 trimitere spre revizie cu întrebări fără răspuns → 400', async () => {
    const response = await put(newId(), inspectionBody({ status: 'submitted', answers: { q1: { value: 'pass' } } }));
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.error.details.map((d) => d.path), ['answers.q2', 'answers.q3', 'answers.q4', 'answers.q5']);
  });

  test('T-STATE-04 inspecție trimisă: o modificare nouă → 409 INSPECTION_LOCKED, cu starea serverului', async () => {
    const id = newId();
    await put(id, inspectionBody({ status: 'submitted', answers: fullAnswers(), clientUpdatedAt: at(5) }));
    const response = await put(id, inspectionBody({ location: 'Modificare târzie', clientUpdatedAt: at(1) }));
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INSPECTION_LOCKED');
    assert.equal(response.body.inspection.status, 'submitted');
    assert.notEqual((await stored(id)).location, 'Modificare târzie');
  });

  test('T-CONF-05 duplicatul cererii care a trimis inspecția → 200 applied=false, nu 409', async () => {
    const id = newId();
    const body = inspectionBody({ status: 'submitted', answers: fullAnswers(), clientUpdatedAt: at(5) });
    await put(id, body);
    const duplicate = await put(id, body);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.applied, false);
  });

  test('o asignare poate fi trimisă direct; după returnare se poate edita, retrimite și aproba (T-STATE-07, T-FLOW-03)', async () => {
    const assigned = await s.api('POST', '/api/inspections', {
      token: coord, body: { templateId: 2, inspectorId: s.data.inspectors[0].id, location: 'Școala nr. 5, hol', dueDate: '2026-12-01' }
    });
    assert.equal(assigned.status, 201);
    assert.equal(assigned.body.status, 'assigned');
    assert.equal(assigned.body.dueDate, '2026-12-01');
    const { id } = assigned.body;

    assert.equal((await put(id, inspectionBody({ status: 'submitted', answers: fullAnswers(), clientUpdatedAt: at(9) }))).status, 200);

    const returned = await s.api('POST', `/api/inspections/${id}/review`, { token: coord, body: { decision: 'return', comment: 'Lipsesc observațiile.' } });
    assert.equal(returned.body.status, 'returned');
    assert.equal(returned.body.reviewComment, 'Lipsesc observațiile.');

    const edited = await put(id, inspectionBody({ status: 'in_progress', answers: fullAnswers(), clientUpdatedAt: at(5) }));
    assert.equal(edited.body.inspection.status, 'in_progress');
    const resubmitted = await put(id, inspectionBody({ status: 'submitted', answers: fullAnswers(), clientUpdatedAt: at(2) }));
    assert.equal(resubmitted.body.inspection.status, 'submitted');

    // T-FLOW-03: după retrimitere, coordonatorul o poate aproba.
    const approved = await s.api('POST', `/api/inspections/${id}/review`, { token: coord, body: { decision: 'approve' } });
    assert.equal(approved.body.status, 'approved');
  });

  test('asignare: prima editare se aplică chiar dacă ceasul telefonului e cu o oră în urma serverului', async () => {
    const { body } = await s.api('POST', '/api/inspections', {
      token: coord, body: { templateId: 2, inspectorId: s.data.inspectors[0].id, location: 'Hotel Central, etaj 2' }
    });
    const edit = await put(body.id, inspectionBody({ clientUpdatedAt: at(60) }));
    assert.equal(edit.body.applied, true);
    assert.equal(edit.body.inspection.status, 'in_progress');
  });

  test('T-STATE-05 revizie pe o inspecție care nu e submitted (inclusiv a doua aprobare) → 409', async () => {
    const id = newId();
    await put(id, inspectionBody({ clientUpdatedAt: at(5) }));
    const notSubmitted = await s.api('POST', `/api/inspections/${id}/review`, { token: coord, body: { decision: 'approve' } });
    assert.equal(notSubmitted.status, 409);
    assert.equal(notSubmitted.body.error.code, 'INVALID_TRANSITION');

    await put(id, inspectionBody({ status: 'submitted', answers: fullAnswers(), clientUpdatedAt: at(2) }));
    assert.equal((await s.api('POST', `/api/inspections/${id}/review`, { token: coord, body: { decision: 'approve' } })).status, 200);
    assert.equal((await s.api('POST', `/api/inspections/${id}/review`, { token: coord, body: { decision: 'approve' } })).status, 409);
  });

  test('T-STATE-06 returnare fără comentariu → 400', async () => {
    const id = newId();
    await put(id, inspectionBody({ status: 'submitted', answers: fullAnswers(), clientUpdatedAt: at(5) }));
    const { status } = await s.api('POST', `/api/inspections/${id}/review`, { token: coord, body: { decision: 'return' } });
    assert.equal(status, 400);
  });

  test('revizie pe o inspecție inexistentă → 404', async () => {
    const { status } = await s.api('POST', `/api/inspections/${newId()}/review`, { token: coord, body: { decision: 'approve' } });
    assert.equal(status, 404);
  });

  test('inspecția aprobată rămâne blocată pentru inspector', async () => {
    const id = newId();
    await put(id, inspectionBody({ status: 'submitted', answers: fullAnswers(), clientUpdatedAt: at(5) }));
    await s.api('POST', `/api/inspections/${id}/review`, { token: coord, body: { decision: 'approve' } });
    const response = await put(id, inspectionBody({ clientUpdatedAt: at(1) }));
    assert.equal(response.status, 409);
    assert.equal(response.body.inspection.status, 'approved');
  });
});
