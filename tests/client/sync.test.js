import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createRequest, NetworkError } from '../../client/src/lib/http.js';
import { createSyncEngine, MESSAGES } from '../../client/src/lib/sync.js';
import { fullAnswers, startTestServer } from '../helpers.js';

// Pachetul OFF, partea de client: modulul de sincronizare rulat în Node.
// Stocarea e un Map în memorie (în browser e IndexedDB), iar rețeaua se poate „opri”.

const memoryStore = (map = new Map()) => ({
  map,
  get: async (key) => structuredClone(map.get(key)),
  set: async (key, value) => { map.set(key, structuredClone(value)); }
});

// Rețea controlabilă peste fetch-ul real: offline → eroare, ca în modul avion.
function network(baseUrl) {
  const net = { online: true, calls: [] };
  net.request = createRequest({
    baseUrl,
    sleep: async () => {},
    fetchFn: async (url, options) => {
      net.calls.push(`${options.method} ${url.replace(baseUrl, '')}`);
      if (!net.online) throw new TypeError('fetch failed');
      return fetch(url, options);
    }
  });
  return net;
}

describe('cereri HTTP: timeout și reîncercări (R12)', () => {
  const response = (status, body = {}) => ({ status, text: async () => JSON.stringify(body) });

  test('T-SYNC-01 eroare de rețea, apoi succes → reîncearcă și reușește', async () => {
    let calls = 0;
    const delays = [];
    const request = createRequest({
      sleep: async (ms) => delays.push(ms),
      fetchFn: async () => { calls += 1; if (calls === 1) throw new TypeError('fetch failed'); return response(200, { ok: true }); }
    });
    const result = await request('GET', '/x');
    assert.deepEqual([result.status, result.body], [200, { ok: true }]);
    assert.equal(calls, 2);
    assert.deepEqual(delays, [500]);
  });

  test('T-SYNC-02 timeout la fiecare încercare → se oprește după 3 încercări', async () => {
    let calls = 0;
    const request = createRequest({
      timeoutMs: 20,
      sleep: async () => {},
      fetchFn: (url, { signal }) => {
        calls += 1;
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      }
    });
    await assert.rejects(request('GET', '/x'), (error) => error instanceof NetworkError && /nu a răspuns/.test(error.message));
    assert.equal(calls, 3);
  });

  test('5xx se reîncearcă, 4xx nu', async () => {
    const statuses = [503, 200];
    let calls = 0;
    const retrying = createRequest({ sleep: async () => {}, fetchFn: async () => response(statuses[calls++]) });
    assert.equal((await retrying('GET', '/x')).status, 200);
    assert.equal(calls, 2);

    let calls4xx = 0;
    const notRetrying = createRequest({ sleep: async () => {}, fetchFn: async () => { calls4xx += 1; return response(400); } });
    assert.equal((await notRetrying('GET', '/x')).status, 400);
    assert.equal(calls4xx, 1);
  });

  test('3 răspunsuri 5xx → NetworkError', async () => {
    const request = createRequest({ sleep: async () => {}, fetchFn: async () => response(500) });
    await assert.rejects(request('GET', '/x'), /Eroare de server \(500\)/);
  });

  test('un corp care nu e JSON nu oprește clientul', async () => {
    const request = createRequest({ fetchFn: async () => ({ status: 502, text: async () => '<html>' }), sleep: async () => {}, delaysMs: [] });
    await assert.rejects(request('GET', '/x'), NetworkError);
  });
});

describe('motorul de sincronizare contra serverului real', () => {
  let s;
  before(async () => { s = await startTestServer(); });
  after(() => s.close());

  async function engineFor(username, { store = memoryStore(), net = network(s.baseUrl) } = {}) {
    const engine = createSyncEngine({ store, request: net.request });
    await engine.init();
    const result = await engine.login(username, username === 'coord' ? 'coord123' : 'insp123');
    assert.equal(result.ok, true);
    await engine.sync();
    return { engine, store, net };
  }

  test('după login și sincronizare, inspectorul are local doar inspecțiile lui și șabloanele', async () => {
    const { engine } = await engineFor('inspector1');
    const { inspections, templates } = engine.snapshot();
    const own = await s.db.models.Inspection.count({ where: { inspectorId: s.data.inspectors[0].id } });
    assert.equal(inspections.length, own);
    assert.equal(templates.length, 2);
    assert.ok(inspections.every((i) => Array.isArray(i.photos)));
  });

  test('T-SYNC-09 offline: creare + editare, „restart” (motor nou, aceeași stocare), revenire online → pe server', async () => {
    const { engine, store, net } = await engineFor('inspector2');
    const assigned = engine.snapshot().inspections.find((i) => i.status === 'assigned');

    net.online = false;
    const created = await engine.saveDraft({ templateId: 2, location: 'Parcare Unirii, nivel -3', status: 'in_progress', answers: { q1: { value: 'fail', note: 'Ușă blocată' } } });
    await engine.saveDraft({ id: assigned.id, templateId: assigned.templateId, location: assigned.location, status: 'in_progress', answers: { q1: { value: 'pass', note: '' } } });
    await engine.sync();
    assert.equal(engine.snapshot().pendingCount, 2);
    assert.match(engine.snapshot().lastError, /Fără conexiune/);

    // Restart: aplicația pornește din nou, din aceeași stocare, încă offline.
    const restarted = createSyncEngine({ store, request: net.request });
    await restarted.init();
    assert.equal(restarted.snapshot().pendingCount, 2);
    assert.equal(restarted.getInspection(created).location, 'Parcare Unirii, nivel -3');

    net.online = true;
    await restarted.sync();
    assert.equal(restarted.snapshot().pendingCount, 0);
    assert.equal(restarted.snapshot().lastError, null);
    assert.equal((await s.db.models.Inspection.findByPk(created)).location, 'Parcare Unirii, nivel -3');
    assert.equal((await s.db.models.Inspection.findByPk(assigned.id)).status, 'in_progress');
  });

  test('T-SYNC-03 răspuns pierdut + reîncercare → 1 rând, fără mesaj de conflict', async () => {
    const store = memoryStore();
    const base = network(s.baseUrl);
    let lost = false;
    // Prima cerere PUT ajunge la server, dar răspunsul se „pierde”.
    const request = async (method, path, options) => {
      if (method === 'PUT' && !lost) {
        lost = true;
        await base.request(method, path, options);
        throw new NetworkError('Fără conexiune la server');
      }
      return base.request(method, path, options);
    };
    const engine = createSyncEngine({ store, request });
    await engine.init();
    await engine.login('inspector3', 'insp123');
    const id = await engine.saveDraft({ templateId: 1, location: 'Hotel Central, etaj 1', status: 'in_progress', answers: {} });
    await engine.sync();
    assert.equal(engine.snapshot().pendingCount, 1);
    await engine.sync();
    assert.equal(engine.snapshot().pendingCount, 0);
    assert.equal(engine.getInspection(id).notice, null);
    assert.equal(await s.db.models.Inspection.count({ where: { id } }), 1);
  });

  test('T-SYNC-08 conflict: două dispozitive, se păstrează modificarea cea mai recentă, cu mesaj', async () => {
    const a = await engineFor('inspector1');
    const b = await engineFor('inspector1');
    const target = a.engine.snapshot().inspections.find((i) => i.status === 'in_progress');
    const edit = (engine, location) => engine.saveDraft({ id: target.id, templateId: target.templateId, location, status: 'in_progress', answers: target.answers });

    a.net.online = false;
    b.net.online = false;
    await edit(b.engine, 'Varianta B (mai veche)');
    await new Promise((r) => setTimeout(r, 5));
    await edit(a.engine, 'Varianta A (mai nouă)');

    a.net.online = true;
    await a.engine.sync();
    b.net.online = true;
    await b.engine.sync();

    assert.equal((await s.db.models.Inspection.findByPk(target.id)).location, 'Varianta A (mai nouă)');
    const onB = b.engine.getInspection(target.id);
    assert.equal(onB.location, 'Varianta A (mai nouă)');
    assert.equal(onB.notice.message, MESSAGES.replaced);
    await b.engine.dismissNotice(target.id);
    assert.equal(b.engine.getInspection(target.id).notice, null);
  });

  test('T-SYNC-04 409: inspecția a fost trimisă de pe alt dispozitiv → se preia starea serverului, cu mesaj', async () => {
    const a = await engineFor('inspector2');
    const b = await engineFor('inspector2');
    const target = a.engine.snapshot().inspections.find((i) => i.status === 'in_progress' && i.templateId === 2);

    b.net.online = false;
    await a.engine.saveDraft({ id: target.id, templateId: 2, location: target.location, status: 'submitted', answers: fullAnswers() });
    await a.engine.sync();
    await new Promise((r) => setTimeout(r, 5));
    await b.engine.saveDraft({ id: target.id, templateId: 2, location: 'Editare târzie', status: 'in_progress', answers: target.answers });
    b.net.online = true;
    await b.engine.sync();

    const onB = b.engine.getInspection(target.id);
    assert.equal(onB.status, 'submitted');
    assert.equal(onB.notice.type, 'locked');
    assert.equal(b.engine.snapshot().pendingCount, 0);
    assert.notEqual((await s.db.models.Inspection.findByPk(target.id)).location, 'Editare târzie');
  });

  test('T-SYNC-05 400: draft-ul rămâne, cu mesajul serverului, și nu se mai retrimite', async () => {
    const { engine, net } = await engineFor('inspector3');
    const id = await engine.saveDraft({ templateId: 2, location: 'Bloc C, hol', status: 'submitted', answers: { q1: { value: 'pass', note: '' } } });
    await engine.sync();
    const local = engine.getInspection(id);
    assert.equal(local.hasDraft, true);
    assert.equal(local.pending, false);
    assert.match(local.error, /Date invalide.*nu are răspuns/);
    const puts = net.calls.filter((c) => c.startsWith('PUT')).length;
    await engine.sync();
    assert.equal(net.calls.filter((c) => c.startsWith('PUT')).length, puts);
  });

  test('T-SYNC-06 401 (sesiune expirată): coada rămâne intactă; după login, sincronizarea continuă', async () => {
    const { engine } = await engineFor('inspector1');
    const id = await engine.saveDraft({ templateId: 2, location: 'Școala nr. 12, sala de sport', status: 'in_progress', answers: {} });
    await s.db.models.Session.destroy({ where: {} });
    await engine.sync();
    assert.equal(engine.snapshot().authExpired, true);
    assert.equal(engine.snapshot().pendingCount, 1);

    await engine.login('inspector1', 'insp123');
    await engine.sync();
    assert.equal(engine.snapshot().pendingCount, 0);
    assert.ok(await s.db.models.Inspection.findByPk(id));
  });

  test('T-SYNC-07 două sincronizări simultane → o singură rulare', async () => {
    const { engine, net } = await engineFor('inspector3');
    await engine.saveDraft({ templateId: 1, location: 'Depozit Logistic, rampa 1', status: 'in_progress', answers: {} });
    const before = net.calls.filter((c) => c.startsWith('PUT')).length;
    const [p1, p2] = [engine.sync(), engine.sync()];
    assert.equal(p1, p2);
    await p1;
    assert.equal(net.calls.filter((c) => c.startsWith('PUT')).length - before, 1);
  });

  test('T-SYNC-10 o modificare făcută în timpul trimiterii e trimisă automat, fără alt apel de sincronizare', async () => {
    const store = memoryStore();
    const base = network(s.baseUrl);
    let engine;
    let editedDuringPut = false;
    let id;
    const request = async (method, path, options) => {
      if (method === 'PUT' && !editedDuringPut) {
        editedDuringPut = true;
        await engine.saveDraft({ id, templateId: 1, location: 'Varianta din timpul trimiterii', status: 'in_progress', answers: {} });
      }
      return base.request(method, path, options);
    };
    engine = createSyncEngine({ store, request });
    await engine.init();
    await engine.login('inspector1', 'insp123');
    id = await engine.saveDraft({ templateId: 1, location: 'Prima variantă', status: 'in_progress', answers: {} });
    // Un singur apel: modificarea din timpul trimiterii pleacă singură, într-o rundă suplimentară.
    await engine.sync();
    assert.equal(engine.snapshot().pendingCount, 0);
    assert.equal((await s.db.models.Inspection.findByPk(id)).location, 'Varianta din timpul trimiterii');
  });

  test('T-SYNC-11 alt utilizator: refuzat cât există modificări nesincronizate; apoi nu vede datele celui anterior', async () => {
    const { engine, store, net } = await engineFor('inspector1');
    net.online = false;
    await engine.saveDraft({ templateId: 1, location: 'Date private inspector1', status: 'in_progress', answers: {} });
    net.online = true;

    // Cu o modificare în coadă, alt cont nu se poate autentifica (s-ar pierde modificarea, R13).
    const refused = await engine.login('inspector2', 'insp123');
    assert.equal(refused.ok, false);
    assert.match(refused.message, /1 modificări nesincronizate ale contului „inspector1”/);
    assert.equal(engine.snapshot().pendingCount, 1);

    await engine.sync();
    const result = await engine.login('inspector2', 'insp123');
    assert.equal(result.ok, true);
    assert.equal(engine.snapshot().inspections.length, 0);
    assert.equal(engine.snapshot().pendingCount, 0);
    await engine.logout();
    assert.equal(engine.snapshot().session, null);
    assert.equal(store.map.get('session'), null);
  });

  test('T-SYNC-12 conflict în ordinea inversă: varianta veche ajunge prima, cea nouă o înlocuiește → mesaj pe primul dispozitiv', async () => {
    const a = await engineFor('inspector3');
    const b = await engineFor('inspector3');
    const target = a.engine.snapshot().inspections.find((i) => i.status === 'in_progress');
    const edit = (engine, location) => engine.saveDraft({ id: target.id, templateId: target.templateId, location, status: 'in_progress', answers: target.answers });

    a.net.online = false;
    b.net.online = false;
    await edit(b.engine, 'Varianta B (mai veche)');
    await new Promise((r) => setTimeout(r, 5));
    await edit(a.engine, 'Varianta A (mai nouă)');

    // B (varianta veche) sincronizează primul și e acceptat; apoi A o înlocuiește.
    b.net.online = true;
    await b.engine.sync();
    assert.equal(b.engine.getInspection(target.id).notice, null);
    a.net.online = true;
    await a.engine.sync();
    assert.equal(a.engine.getInspection(target.id).notice, null);

    // La următoarea sincronizare, B află că modificarea lui a fost înlocuită.
    await b.engine.sync();
    const onB = b.engine.getInspection(target.id);
    assert.equal(onB.location, 'Varianta A (mai nouă)');
    assert.equal(onB.notice.type, 'overwritten');
    assert.equal(onB.notice.message, MESSAGES.overwritten);
  });

  test('T-SYNC-13 ceas greșit: diferența față de server e corectată la marcajele de timp', async () => {
    const tenMinutes = 10 * 60 * 1000;
    const base = network(s.baseUrl);
    // Dispozitivul are ceasul cu 10 minute ÎNAINTE: fără corecție, serverul ar respinge (R8)
    // fiecare salvare, iar dacă ar fi doar 4 minute, ar câștiga pe nedrept orice conflict.
    const engine = createSyncEngine({ store: memoryStore(), request: base.request, now: () => new Date(Date.now() + tenMinutes) });
    await engine.init();
    await engine.login('inspector1', 'insp123');
    const id = await engine.saveDraft({ templateId: 1, location: 'Ceas dat înainte', status: 'in_progress', answers: {} });
    const saved = Date.parse(engine.getInspection(id).clientUpdatedAt);
    assert.ok(Math.abs(saved - Date.now()) < 3000, `marcaj corectat: ${new Date(saved).toISOString()}`);
    await engine.sync();
    assert.equal(engine.snapshot().pendingCount, 0);
    assert.ok(await s.db.models.Inspection.findByPk(id));
  });

  test('T-SYNC-14 ceas cu 2,2 s în urmă, 20 de editări consecutive: niciuna nu se pierde, niciun conflict fals', async () => {
    // Regresie găsită la a doua evaluare: lângă prag, corecția de ceas „sărea” între 0 și ~2,5 s,
    // iar o editare putea primi un marcaj mai vechi decât precedenta.
    const engine = createSyncEngine({ store: memoryStore(), request: network(s.baseUrl).request, now: () => new Date(Date.now() - 2200) });
    await engine.init();
    await engine.login('inspector2', 'insp123');
    await engine.sync();
    const target = engine.snapshot().inspections.find((i) => i.status === 'in_progress');
    for (let n = 1; n <= 20; n += 1) {
      await engine.saveDraft({ id: target.id, templateId: target.templateId, location: `Editarea ${n}`, status: 'in_progress', answers: target.answers });
      await engine.sync();
      const local = engine.getInspection(target.id);
      assert.equal(local.location, `Editarea ${n}`, `editarea ${n} a fost înlocuită`);
      assert.equal(local.notice, null, `conflict fals la editarea ${n}`);
      await new Promise((r) => setTimeout(r, 100 + (n % 4) * 100));
    }
    assert.equal((await s.db.models.Inspection.findByPk(target.id)).location, 'Editarea 20');
  });

  test('T-SYNC-15 o editare făcută după ce ai văzut varianta altui dispozitiv o înlocuiește, chiar cu ceasul puțin în urmă', async () => {
    const ahead = await engineFor('inspector3');
    // Dispozitivul „behind” are ceasul cu 1,5 s în urmă: sub prag, deci fără corecție.
    const behind = createSyncEngine({ store: memoryStore(), request: network(s.baseUrl).request, now: () => new Date(Date.now() - 1500) });
    await behind.init();
    await behind.login('inspector3', 'insp123');
    const target = ahead.engine.snapshot().inspections.find((i) => i.status === 'assigned' || i.status === 'in_progress');

    await ahead.engine.saveDraft({ id: target.id, templateId: target.templateId, location: 'De pe telefonul cu ceasul corect', status: 'in_progress', answers: {} });
    await ahead.engine.sync();
    await behind.sync(); // vede varianta de mai sus…
    await behind.saveDraft({ id: target.id, templateId: target.templateId, location: 'Editată după ce am văzut-o', status: 'in_progress', answers: {} }); // …și o editează imediat
    await behind.sync();

    assert.equal(behind.getInspection(target.id).notice, null);
    assert.equal((await s.db.models.Inspection.findByPk(target.id)).location, 'Editată după ce am văzut-o');
  });

  test('T-SYNC-16 draft respins de server (400): e numărat ca nesalvat, iar alt cont nu se poate autentifica', async () => {
    const { engine } = await engineFor('inspector1');
    await engine.saveDraft({ templateId: 2, location: 'Bloc A, de corectat', status: 'submitted', answers: {} });
    await engine.sync();
    assert.equal(engine.snapshot().pendingCount, 0); // respins, deci nu mai e în coadă…
    assert.equal(engine.snapshot().unsavedCount, 1); // …dar e încă nesalvat pe server
    const refused = await engine.login('inspector2', 'insp123');
    assert.equal(refused.ok, false);
  });

  test('T-SYNC-17 o descărcare lentă nu e confundată cu un ceas greșit', async () => {
    // Regresie găsită la a treia evaluare: diferența de ceas era măsurată după descărcarea corpului,
    // deci un răspuns lent (poze, semnal slab) arăta ca un ceas „înainte”.
    const slowBody = createRequest({
      baseUrl: s.baseUrl,
      sleep: async () => {},
      fetchFn: async (url, options) => {
        const response = await fetch(url, options);
        if (options.method !== 'GET' || !url.includes('/api/inspections/')) return response;
        return { status: response.status, headers: response.headers, text: async () => { await new Promise((r) => setTimeout(r, 3000)); return response.text(); } };
      }
    });
    const engine = createSyncEngine({ store: memoryStore(), request: slowBody });
    await engine.init();
    await engine.login('inspector1', 'insp123');
    await engine.sync(); // descarcă detaliile, fiecare cu corpul întârziat 3 s
    const before = Date.now();
    const id = await engine.saveDraft({ templateId: 1, location: 'După descărcări lente', status: 'in_progress', answers: {} });
    const saved = Date.parse(engine.getInspection(id).clientUpdatedAt);
    assert.ok(Math.abs(saved - before) < 1500, `marcaj deplasat cu ${saved - before} ms`);
  });

  test('T-SYNC-18 refuz (400) pentru o variantă deja corectată local: varianta corectă pleacă totuși', async () => {
    const base = network(s.baseUrl);
    let engine;
    let id;
    let corrected = false;
    const request = async (method, path, options) => {
      if (method === 'PUT' && !corrected) {
        corrected = true; // utilizatorul corectează formularul cât prima cerere e pe drum
        await engine.saveDraft({ id, templateId: 2, location: 'Bloc A, varianta corectă', status: 'in_progress', answers: {} });
      }
      return base.request(method, path, options);
    };
    engine = createSyncEngine({ store: memoryStore(), request });
    await engine.init();
    await engine.login('inspector2', 'insp123');
    // Prima variantă e invalidă: trimisă spre revizie fără răspunsuri → 400.
    id = await engine.saveDraft({ templateId: 2, location: 'Bloc A, varianta greșită', status: 'submitted', answers: {} });
    await engine.sync();
    const local = engine.getInspection(id);
    assert.equal(engine.snapshot().unsavedCount, 0);
    assert.equal(local.error, null);
    assert.equal((await s.db.models.Inspection.findByPk(id)).location, 'Bloc A, varianta corectă');
  });

  test('T-SYNC-19 dacă salvarea în stocare eșuează, modificarea nu apare ca salvată', async () => {
    const store = memoryStore();
    const failing = { ...store, set: async (key, value) => { if (key === 'drafts' && fail) throw new Error('QuotaExceededError'); return store.set(key, value); } };
    let fail = false;
    const engine = createSyncEngine({ store: failing, request: async () => ({ status: 500 }) });
    await engine.init();
    const id = await engine.saveDraft({ templateId: 1, location: 'Prima', status: 'in_progress', answers: {} });
    fail = true;
    await assert.rejects(engine.saveDraft({ id, templateId: 1, location: 'A doua', status: 'in_progress', answers: {} }), /nu a putut fi salvată pe dispozitiv/);
    assert.equal(engine.getInspection(id).location, 'Prima');
    fail = false;
    await engine.saveDraft({ id, templateId: 1, location: 'A treia', status: 'in_progress', answers: {} });
    assert.equal(engine.getInspection(id).location, 'A treia');
  });

  test('T-SYNC-20 o cerere reîncercată după timeout nu e confundată cu un ceas greșit', async () => {
    // Regresie găsită la a patra evaluare: timpul încercării eșuate (și pauza de după ea) era
    // socotit în diferența de ceas, deci un telefon cu ceasul corect primea o corecție de +5,5 s
    // după un singur timeout și câștiga pe nedrept conflictele.
    let hang = true;
    const request = createRequest({
      baseUrl: s.baseUrl,
      timeoutMs: 2500,
      sleep: async () => {},
      fetchFn: (url, options) => {
        if (hang && options.method === 'POST') {
          hang = false; // prima încercare de login „atârnă” până la timeout, a doua reușește
          return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
        }
        return fetch(url, options);
      }
    });
    const engine = createSyncEngine({ store: memoryStore(), request });
    await engine.init();
    assert.equal((await engine.login('inspector1', 'insp123')).ok, true);
    assert.equal(hang, false);
    const before = Date.now();
    const id = await engine.saveDraft({ templateId: 1, location: 'După un timeout', status: 'in_progress', answers: {} });
    const saved = Date.parse(engine.getInspection(id).clientUpdatedAt);
    assert.ok(Math.abs(saved - before) < 1500, `marcaj deplasat cu ${saved - before} ms`);
  });

  test('T-SYNC-21 rețea lentă (antete în peste 1 s): un ceas greșit cu 10 minute e totuși corectat', async () => {
    // Regresie găsită la a patra evaluare: răspunsurile lente erau ignorate cu totul, deci pe o
    // rețea lentă ceasul nu se corecta niciodată, iar serverul respingea fiecare modificare (R8).
    const tenMinutes = 10 * 60 * 1000;
    const request = createRequest({
      baseUrl: s.baseUrl,
      sleep: async () => {},
      fetchFn: async (url, options) => {
        const response = await fetch(url, options);
        await new Promise((r) => setTimeout(r, 1200)); // antetele sosesc după 1,2 s
        return response;
      }
    });
    const engine = createSyncEngine({ store: memoryStore(), request, now: () => new Date(Date.now() + tenMinutes) });
    await engine.init();
    assert.equal((await engine.login('inspector1', 'insp123')).ok, true);
    const id = await engine.saveDraft({ templateId: 1, location: 'Ceas înainte, rețea lentă', status: 'in_progress', answers: {} });
    const saved = Date.parse(engine.getInspection(id).clientUpdatedAt);
    assert.ok(Math.abs(saved - Date.now()) < 3000, `marcaj necorectat: ${new Date(saved).toISOString()}`);
  });

  test('o diferență sub prag, măsurată pe o rețea lentă, nu mută un ceas corect', async () => {
    // Un răspuns lent are o eroare de până la 500 ms + jumătate din drumul dus-întors: nu trebuie
    // să producă o corecție pentru un ceas care e de fapt corect.
    const request = createRequest({
      baseUrl: s.baseUrl,
      sleep: async () => {},
      fetchFn: async (url, options) => {
        const response = await fetch(url, options);
        await new Promise((r) => setTimeout(r, 3000));
        return response;
      }
    });
    const store = memoryStore();
    const engine = createSyncEngine({ store, request });
    await engine.init();
    assert.equal((await engine.login('inspector1', 'insp123')).ok, true);
    assert.equal(store.map.get('clockOffset') ?? 0, 0);
  });

  test('sincronizarea periodică nu cere șabloanele de fiecare dată', async () => {
    const { engine, net } = await engineFor('inspector3');
    const count = () => net.calls.filter((c) => c.endsWith('/api/templates')).length;
    const before = count();
    await engine.sync();
    await engine.sync();
    assert.equal(count(), before);
  });

  test('o diferență mică de ceas (sub 2 s) e ignorată', async () => {
    const engine = createSyncEngine({ store: memoryStore(), request: network(s.baseUrl).request });
    await engine.init();
    await engine.login('inspector1', 'insp123');
    const before = Date.now();
    const id = await engine.saveDraft({ templateId: 1, location: 'Ceas corect', status: 'in_progress', answers: {} });
    const saved = Date.parse(engine.getInspection(id).clientUpdatedAt);
    assert.ok(saved >= before && saved <= Date.now());
  });

  test('login cu parolă greșită întoarce mesajul serverului', async () => {
    const engine = createSyncEngine({ store: memoryStore(), request: network(s.baseUrl).request });
    await engine.init();
    const result = await engine.login('inspector1', 'gresit');
    assert.deepEqual(result, { ok: false, message: 'Username sau parolă incorecte' });
  });

  test('două salvări în aceeași milisecundă: a doua e strict mai nouă', async () => {
    const fixed = new Date('2026-11-20T10:00:00.000Z');
    const engine = createSyncEngine({ store: memoryStore(), request: async () => ({ status: 500 }), now: () => fixed });
    await engine.init();
    const id = await engine.saveDraft({ templateId: 1, location: 'A', status: 'in_progress', answers: {} });
    await engine.saveDraft({ id, templateId: 1, location: 'B', status: 'in_progress', answers: {} });
    assert.equal(engine.getInspection(id).clientUpdatedAt, '2026-11-20T10:00:00.001Z');
  });
});
