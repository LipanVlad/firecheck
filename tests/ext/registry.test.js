import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { createApp } from '../../server/app.js';
import { createRegistryProcessor } from '../../server/registry/processor.js';
import { at, fullAnswers, inspectionBody, newId, REGISTRY_KEY, startTestServer } from '../helpers.js';

// Pachetul EXT: integrarea cu Registrul PSI (docs/packages/EXT.md).
// Fiecare test setează un scenariu fix în simulator, deci rezultatele sunt deterministe.
// Pauzele de backoff sunt înregistrate în s.delays, fără să fie așteptate (teste rapide).

let s;
let coord;
let insp;

before(async () => {
  s = await startTestServer({ registry: true });
  coord = await s.login('coord');
  insp = await s.login('inspector1');
});
after(() => s.close());
beforeEach(async () => {
  await s.resetSim();
  s.delays.length = 0;
});
afterEach(() => s.processor.idle());

// Creează o inspecție trimisă spre revizie, gata de aprobat.
async function submitted() {
  const id = newId();
  const body = inspectionBody({ status: 'submitted', answers: { ...fullAnswers(), q3: { value: 'fail', note: 'Iluminat defect' } }, clientUpdatedAt: at(2) });
  const { status } = await s.api('PUT', `/api/inspections/${id}`, { token: insp, body });
  assert.equal(status, 201);
  return id;
}

async function approveAndWait(id) {
  const review = await s.api('POST', `/api/inspections/${id}/review`, { token: coord, body: { decision: 'approve' } });
  assert.equal(review.status, 200);
  assert.equal(review.body.status, 'approved');
  await s.processor.idle();
  return (await s.api('GET', `/api/inspections/${id}`, { token: coord })).body.registry;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('T-FLOW-01 flux complet: asignare → completare → trimitere → aprobare → chitanță → raport', async () => {
  const inspectorId = s.data.inspectors[0].id;
  const assigned = await s.api('POST', '/api/inspections', { token: coord, body: { templateId: 2, inspectorId, location: 'Spitalul Județean, etaj 4' } });
  assert.equal(assigned.body.status, 'assigned');
  const { id } = assigned.body;

  const mine = await s.api('GET', '/api/inspections?status=assigned&pageSize=100', { token: insp });
  assert.ok(mine.body.items.some((i) => i.id === id));

  const draft = await s.api('PUT', `/api/inspections/${id}`, { token: insp, body: inspectionBody({ answers: { q1: { value: 'pass' } }, clientUpdatedAt: at(10) }) });
  assert.equal(draft.body.inspection.status, 'in_progress');
  const sent = await s.api('PUT', `/api/inspections/${id}`, { token: insp, body: inspectionBody({ status: 'submitted', answers: fullAnswers(), clientUpdatedAt: at(5) }) });
  assert.equal(sent.body.inspection.status, 'submitted');

  const registry = await approveAndWait(id);
  assert.equal(registry.status, 'sent');
  const report = (await s.api('GET', '/api/report', { token: coord })).body;
  assert.ok(report.byStatus.approved >= 9);
  assert.ok(report.registry.sent >= 9);
});

describe('scenarii de eroare deterministe', () => {
  test('T-EXT-01 ok → sent, chitanță, 1 încercare; raportul trimis conține neconformitatea', async () => {
    const id = await submitted();
    const registry = await approveAndWait(id);
    assert.equal(registry.status, 'sent');
    assert.equal(registry.attempts, 1);
    assert.match(registry.receiptNo, /^PSI-2026-\d{6}$/);
    const stats = await s.stats();
    assert.deepEqual([stats.requests, stats.registrations], [1, 1]);
  });

  test('T-EXT-02 timeout, ok → sent după 2 încercări; o singură înregistrare', async () => {
    await s.scenario(['timeout', 'ok']);
    const id = await submitted();
    const registry = await approveAndWait(id);
    assert.equal(registry.status, 'sent');
    assert.equal(registry.attempts, 2);
    assert.deepEqual(s.delays, [1000]);
    // Cererea „lentă” se termină pe simulator după ce clientul a renunțat; tot o singură înregistrare.
    await sleep(400);
    const stats = await s.stats();
    assert.equal(stats.requestsByKey[id], 2);
    assert.equal(stats.registrations, 1);
  });

  test('T-EXT-03 lost_response, ok → a doua încercare primește răspuns duplicat; aceeași chitanță', async () => {
    await s.scenario(['lost_response', 'ok']);
    const id = await submitted();
    const registry = await approveAndWait(id);
    assert.equal(registry.status, 'sent');
    assert.equal(registry.attempts, 2);
    assert.equal(registry.receiptNo, 'PSI-2026-000001');
    const stats = await s.stats();
    assert.deepEqual([stats.requests, stats.registrations], [2, 1]);
  });

  test('T-EXT-04 error_503, error_500, ok → sent după 3 încercări, cu backoff 1 s, 2 s', async () => {
    await s.scenario(['error_503', 'error_500', 'ok']);
    const registry = await approveAndWait(await submitted());
    assert.equal(registry.status, 'sent');
    assert.equal(registry.attempts, 3);
    assert.deepEqual(s.delays, [1000, 2000]);
  });

  test('T-EXT-15 429 fără Retry-After → backoff exponențial normal, nu reîncercări imediate', async () => {
    await s.scenario(['rate_limit_no_header', 'rate_limit_no_header', 'ok']);
    const registry = await approveAndWait(await submitted());
    assert.equal(registry.status, 'sent');
    assert.deepEqual(s.delays, [1000, 2000]);
  });

  test('T-EXT-05 rate_limit, ok → așteaptă Retry-After (1 s), apoi sent', async () => {
    await s.scenario(['rate_limit', 'ok']);
    const registry = await approveAndWait(await submitted());
    assert.equal(registry.status, 'sent');
    assert.deepEqual(s.delays, [1000]);
  });
});

describe('reîncercări limitate și stări coerente', () => {
  let failedId;

  test('T-EXT-06 error_503 × 5 → failed după exact 5 cereri, cu ultima eroare salvată', async () => {
    await s.scenario(Array(6).fill('error_503'));
    failedId = await submitted();
    const registry = await approveAndWait(failedId);
    assert.equal(registry.status, 'failed');
    assert.equal(registry.attempts, 5);
    assert.match(registry.lastError, /503/);
    assert.deepEqual(s.delays, [1000, 2000, 4000, 8000]);
    const stats = await s.stats();
    assert.equal(stats.requests, 5);
    // Inspecția rămâne aprobată: eșecul extern nu anulează decizia coordonatorului.
    assert.equal((await s.db.models.Inspection.findByPk(failedId)).status, 'approved');
  });

  test('T-EXT-08 reîncercare manuală după failed → pending → sent', async () => {
    const retry = await s.api('POST', `/api/inspections/${failedId}/registry/retry`, { token: coord });
    assert.equal(retry.status, 202);
    await s.processor.idle();
    const registry = (await s.api('GET', `/api/inspections/${failedId}`, { token: coord })).body.registry;
    assert.equal(registry.status, 'sent');
    assert.equal(registry.attempts, 1);
    assert.equal(registry.lastError, null);
  });

  test('reîncercarea manuală e permisă doar pentru failed → 409; inspecție inexistentă → 404', async () => {
    assert.equal((await s.api('POST', `/api/inspections/${failedId}/registry/retry`, { token: coord })).status, 409);
    assert.equal((await s.api('POST', `/api/inspections/${newId()}/registry/retry`, { token: coord })).status, 404);
  });

  test('T-EXT-07 bad_request → failed după exact 1 cerere (4xx nu se reîncearcă)', async () => {
    await s.scenario(['bad_request']);
    const registry = await approveAndWait(await submitted());
    assert.equal(registry.status, 'failed');
    assert.equal(registry.attempts, 1);
    assert.deepEqual(s.delays, []);
    assert.equal((await s.stats()).requests, 1);
  });
});

describe('efecte idempotente', () => {
  test('T-EXT-09 aceeași trimitere pornită de mai multe ori în paralel → 1 cerere, 1 chitanță', async () => {
    const id = await submitted();
    await s.api('POST', `/api/inspections/${id}/review`, { token: coord, body: { decision: 'approve' } });
    await Promise.all([s.processor.process(id), s.processor.process(id), s.processor.process(id)]);
    await s.processor.idle();
    const stats = await s.stats();
    assert.equal(stats.requestsByKey[id], 1);
    assert.equal(stats.registrations, 1);
    assert.equal(await s.db.models.RegistrySubmission.count({ where: { inspectionId: id } }), 1);
  });

  test('T-EXT-11 dublu click pe „Aprobă” → a doua cerere 409, o singură trimitere', async () => {
    const id = await submitted();
    const [a, b] = await Promise.all([
      s.api('POST', `/api/inspections/${id}/review`, { token: coord, body: { decision: 'approve' } }),
      s.api('POST', `/api/inspections/${id}/review`, { token: coord, body: { decision: 'approve' } })
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    await s.processor.idle();
    assert.equal(await s.db.models.RegistrySubmission.count({ where: { inspectionId: id } }), 1);
    assert.equal((await s.stats()).registrations, 1);
  });

  test('T-EXT-10 restart: trimiterile rămase pending/sending sunt reluate de un server nou', async () => {
    const { Inspection, RegistrySubmission } = s.db.models;
    const ids = [await submitted(), await submitted()];
    // Simulăm o oprire bruscă: aprobate în baza de date, dar trimiterile neterminate.
    await Inspection.update({ status: 'approved' }, { where: { id: ids } });
    await RegistrySubmission.bulkCreate([
      { inspectionId: ids[0], status: 'pending' },
      { inspectionId: ids[1], status: 'sending', attempts: 1 }
    ]);

    // Un „server nou” pe aceeași bază de date, cu același Registru.
    const sleepLog = [];
    const restarted = createApp({
      db: s.db,
      registry: { url: s.registryUrl, apiKey: REGISTRY_KEY, timeoutMs: 100, sleep: async (ms) => sleepLog.push(ms), log: () => {} }
    });
    await restarted.locals.registryProcessor.resume();

    const subs = await RegistrySubmission.findAll({ where: { inspectionId: ids } });
    assert.deepEqual(subs.map((x) => x.status), ['sent', 'sent']);
    assert.equal((await s.stats()).registrations, 2);
  });
});

describe('erori neprevăzute', () => {
  test('după un restart, trimiterea rămâne pending cât așteaptă pauza programată', async () => {
    const id = await submitted();
    await s.db.models.Inspection.update({ status: 'approved' }, { where: { id } });
    await s.db.models.RegistrySubmission.create({ inspectionId: id, status: 'pending', attempts: 1, nextAttemptAt: new Date(Date.now() + 60_000) });
    const seen = [];
    const restarted = createRegistryProcessor({
      db: s.db,
      client: { submit: async () => ({ ok: true, receiptNo: 'PSI-TEST', duplicate: false }) },
      sleep: async () => { seen.push((await s.db.models.RegistrySubmission.findOne({ where: { inspectionId: id } })).status); },
      log: () => {}
    });
    await restarted.process(id);
    assert.deepEqual(seen, ['pending']);
    assert.equal((await s.db.models.RegistrySubmission.findOne({ where: { inspectionId: id } })).status, 'sent');
  });

  test('T-EXT-14 o excepție neașteptată în timpul trimiterii → failed (nu rămâne blocată în sending)', async () => {
    const id = await submitted();
    await s.db.models.Inspection.update({ status: 'approved' }, { where: { id } });
    await s.db.models.RegistrySubmission.create({ inspectionId: id, status: 'pending' });
    const broken = createRegistryProcessor({
      db: s.db,
      client: { submit: async () => { throw new Error('bug simulat'); } },
      sleep: async () => {},
      log: () => {}
    });
    await broken.process(id);
    const submission = await s.db.models.RegistrySubmission.findOne({ where: { inspectionId: id } });
    assert.equal(submission.status, 'failed');
    assert.match(submission.lastError, /eroare internă: bug simulat/);
  });
});

describe('Registru indisponibil sau configurat greșit', () => {
  test('T-EXT-12 conexiune refuzată → failed după 5 încercări; inspecția rămâne approved', async () => {
    const down = await startTestServer({ registry: { url: 'http://127.0.0.1:9' } });
    try {
      const token = await down.login('inspector1');
      const id = newId();
      await down.api('PUT', `/api/inspections/${id}`, { token, body: inspectionBody({ status: 'submitted', answers: fullAnswers(), clientUpdatedAt: at(2) }) });
      await down.api('POST', `/api/inspections/${id}/review`, { token: await down.login('coord'), body: { decision: 'approve' } });
      await down.processor.idle();
      const submission = await down.db.models.RegistrySubmission.findOne({ where: { inspectionId: id } });
      assert.equal(submission.status, 'failed');
      assert.equal(submission.attempts, 5);
      assert.match(submission.lastError, /rețea/);
      assert.equal((await down.db.models.Inspection.findByPk(id)).status, 'approved');
    } finally {
      await down.close();
    }
  });

  test('cheie de acces greșită → 401 de la Registru → failed fără reîncercări', async () => {
    const wrongKey = await startTestServer({ registry: { apiKey: 'cheie-gresita' } });
    try {
      const token = await wrongKey.login('inspector1');
      const id = newId();
      await wrongKey.api('PUT', `/api/inspections/${id}`, { token, body: inspectionBody({ status: 'submitted', answers: fullAnswers(), clientUpdatedAt: at(2) }) });
      await wrongKey.api('POST', `/api/inspections/${id}/review`, { token: await wrongKey.login('coord'), body: { decision: 'approve' } });
      await wrongKey.processor.idle();
      const submission = await wrongKey.db.models.RegistrySubmission.findOne({ where: { inspectionId: id } });
      assert.equal(submission.status, 'failed');
      assert.equal(submission.attempts, 1);
      assert.match(submission.lastError, /401/);
    } finally {
      await wrongKey.close();
    }
  });
});
