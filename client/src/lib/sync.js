import { NetworkError } from './http.js';

// Motorul de sincronizare offline (pachetul OFF; docs/architecture.md, secțiunea 6).
//
// Nu depinde de React sau de browser: primește o stocare (`store`, cu get/set asincrone) și o
// funcție `request`. În aplicație, stocarea e IndexedDB; în teste, un obiect în memorie.
//
// Ce se păstrează:
//   session      tokenul și utilizatorul (permite pornirea offline)
//   templates    șabloanele
//   inspections  ultima copie confirmată de server, pe ID
//   drafts       modificările locale neconfirmate, pe ID
//   outbox       ID-urile care așteaptă trimiterea
//   notices      mesaje de conflict de afișat, pe ID
//   errors       erori de validare primite de la server, pe ID
//   sentByMe     marcajul de timp al ultimei modificări trimise și acceptate de pe acest dispozitiv,
//                ca să observăm dacă alt dispozitiv a înlocuit-o ulterior
//   clockOffset  diferența dintre ceasul serverului și al dispozitivului (ms), dacă e mare

const KEYS = ['session', 'templates', 'templatesAt', 'inspections', 'drafts', 'outbox', 'notices', 'errors', 'sentByMe', 'clockOffset', 'lastSync'];

const empty = () => ({ session: null, templates: [], templatesAt: null, inspections: {}, drafts: {}, outbox: [], notices: {}, errors: {}, sentByMe: {}, clockOffset: 0, lastSync: null });

export const TEMPLATES_MAX_AGE_MS = 10 * 60 * 1000;

// Pragul corecției de ceas. Antetul Date are rezoluție de o secundă, deci o diferență măsurată
// „sare” de la un răspuns la altul cu până la ~1 s. Corecția se schimbă doar când noua măsurătoare
// se depărtează cu peste prag de cea folosită acum (histerezis), ca să nu oscileze.
export const CLOCK_SKEW_THRESHOLD_MS = 2000;
// Un răspuns ale cărui antete au venit în peste o secundă e mai puțin precis: nu știm în ce moment
// al acelui interval a scris serverul ora. Eroarea măsurătorii e de cel mult 500 ms (rezoluția
// antetului) + jumătate din drumul dus-întors, deci un astfel de răspuns schimbă corecția doar
// dacă diferența depășește pragul plus această eroare. Așa, un ceas corect nu e mutat niciodată
// de un răspuns lent, dar un ceas greșit cu minute întregi e corectat și pe o rețea lentă.
export const CLOCK_MAX_ROUND_TRIP_MS = 1000;
const clockThreshold = (roundTrip) => (roundTrip <= CLOCK_MAX_ROUND_TRIP_MS
  ? CLOCK_SKEW_THRESHOLD_MS
  : CLOCK_SKEW_THRESHOLD_MS + 500 + roundTrip / 2);

export const MESSAGES = {
  replaced: 'Pe server exista o variantă mai nouă a acestei inspecții (de pe alt dispozitiv). Ea a înlocuit modificările de aici.',
  overwritten: 'Inspecția a fost modificată ulterior de pe alt dispozitiv. Varianta afișată e cea mai nouă; modificarea ta de aici a fost înlocuită.',
  locked: 'Inspecția fusese deja trimisă spre revizie sau aprobată. Modificările de pe acest dispozitiv nu au fost aplicate.'
};

class AuthExpired extends Error {}

export function createSyncEngine({ store, request, now = () => new Date(), newId = () => crypto.randomUUID(), onChange = () => {} }) {
  const state = { ...empty(), syncing: false, lastError: null, authExpired: false };
  let running = null;
  let again = false;

  const persist = (...keys) => Promise.all(keys.map((key) => store.set(key, state[key])));
  const emit = () => onChange(snapshot());
  const token = () => state.session?.token;

  // Ora „corectată”: ceasul dispozitivului plus diferența față de server, dacă e semnificativă.
  // Astfel un telefon cu ceasul greșit nu câștigă și nu pierde conflictele pe nedrept (R2, R8).
  const clock = () => new Date(now().getTime() + state.clockOffset);

  async function call(method, path, options) {
    const calledAt = now().getTime();
    const response = await request(method, path, options);
    const roundTrip = response.headersAfterMs;
    if (response.serverTime && roundTrip != null) {
      // Momentul în care a pornit încercarea reușită (după eventualele încercări eșuate și pauze).
      const sentAt = calledAt + (response.startedAfterMs ?? 0);
      // Serverul a scris ora cam la mijlocul drumului dus-întors; +500: mijlocul secundei din antet.
      const measured = response.serverTime + 500 - (sentAt + roundTrip / 2);
      const threshold = clockThreshold(roundTrip);
      if (Math.abs(measured - state.clockOffset) > threshold) {
        state.clockOffset = Math.abs(measured) > threshold ? Math.round(measured) : 0;
        await persist('clockOffset');
      }
    }
    return response;
  }

  function view(id) {
    const server = state.inspections[id];
    const draft = state.drafts[id];
    const base = draft ? { ...server, ...draft } : server;
    if (!base) return null;
    return {
      ...base,
      pending: state.outbox.includes(id),
      hasDraft: Boolean(draft),
      error: state.errors[id] ?? null,
      notice: state.notices[id] ?? null
    };
  }

  function snapshot() {
    const ids = new Set([...Object.keys(state.inspections), ...Object.keys(state.drafts)]);
    return {
      session: state.session,
      templates: state.templates,
      inspections: [...ids].map(view),
      pendingCount: state.outbox.length,
      unsavedCount: Object.keys(state.drafts).length,
      syncing: state.syncing,
      lastSync: state.lastSync,
      lastError: state.lastError,
      authExpired: state.authExpired
    };
  }

  async function init() {
    for (const key of KEYS) {
      const value = await store.get(key);
      if (value !== undefined) state[key] = value;
    }
    emit();
  }

  async function resetData() {
    Object.assign(state, empty());
    await persist(...KEYS);
  }

  async function login(username, password) {
    // Alt utilizator pe un dispozitiv cu modificări nesincronizate: refuzăm, altfel s-ar pierde (R13).
    const previous = state.session?.user.username;
    // Contează toate draft-urile, inclusiv cele respinse de server (400), care nu mai stau în coadă.
    const unsaved = Object.keys(state.drafts).length;
    if (previous && unsaved && previous.toLowerCase() !== username.trim().toLowerCase()) {
      return { ok: false, message: `Pe acest dispozitiv sunt ${unsaved} modificări nesincronizate ale contului „${previous}”. Autentifică-te cu acel cont ca să fie trimise.` };
    }
    const response = await call('POST', '/api/auth/login', { body: { username, password } });
    if (response.status !== 200) {
      return { ok: false, message: response.body?.error?.message ?? 'Autentificare eșuată' };
    }
    // Alt utilizator pe același dispozitiv: datele celui anterior nu rămân vizibile (R4).
    if (state.session && state.session.user.id !== response.body.user.id) await resetData();
    state.session = response.body;
    state.authExpired = false;
    await persist('session');
    emit();
    return { ok: true, user: response.body.user };
  }

  async function logout() {
    try {
      await call('POST', '/api/auth/logout', { token: token() });
    } catch {
      // Offline: sesiunea expiră oricum pe server după 7 zile.
    }
    await resetData();
    state.authExpired = false;
    emit();
  }

  // Salvează imediat o modificare locală și o pune în coadă (R13). Întoarce ID-ul inspecției.
  async function saveDraft(input) {
    const id = input.id ?? newId();
    const previousDraft = state.drafts[id];
    const previous = state.drafts[id] ?? state.inspections[id];
    let time = clock().getTime();
    // O modificare făcută pe baza unei variante (propriul draft sau ultima copie de pe server, pe care
    // utilizatorul a văzut-o) e mereu mai nouă decât acea variantă, chiar dacă ceasul a sărit înapoi.
    // Altfel, serverul ar ignora o editare reală (applied: false) ca fiind „mai veche”.
    const basis = Math.max(
      state.drafts[id] ? Date.parse(state.drafts[id].clientUpdatedAt) : 0,
      state.inspections[id]?.clientUpdatedAt ? Date.parse(state.inspections[id].clientUpdatedAt) : 0
    );
    if (time <= basis) time = basis + 1;

    state.drafts[id] = {
      id,
      templateId: input.templateId,
      location: input.location,
      status: input.status,
      answers: input.answers,
      photos: input.photos ?? previous?.photos ?? [],
      clientUpdatedAt: new Date(time).toISOString(),
      inspectorId: state.session?.user.id,
      dueDate: previous?.dueDate ?? null,
      reviewComment: previous?.reviewComment ?? null
    };
    const before = { draft: previousDraft, outbox: [...state.outbox], error: state.errors[id], notice: state.notices[id] };
    if (!state.outbox.includes(id)) state.outbox.push(id);
    delete state.errors[id];
    delete state.notices[id];
    try {
      await persist('drafts', 'outbox', 'errors', 'notices');
    } catch (error) {
      // Scrierea în IndexedDB a eșuat (de ex. spațiu plin): interfața nu trebuie să arate „salvat”.
      if (before.draft) state.drafts[id] = before.draft;
      else delete state.drafts[id];
      state.outbox = before.outbox;
      if (before.error) state.errors[id] = before.error;
      if (before.notice) state.notices[id] = before.notice;
      emit();
      throw new Error(`Modificarea nu a putut fi salvată pe dispozitiv: ${error.message}`);
    }
    // Dacă o sincronizare rulează chiar acum, mai face o rundă la final pentru această modificare.
    if (state.syncing) again = true;
    emit();
    return id;
  }

  // Inspecția a fost confirmată de server: draft-ul se șterge doar dacă nu s-a modificat între timp.
  function settle(id, sentAt) {
    if (state.drafts[id]?.clientUpdatedAt === sentAt) {
      delete state.drafts[id];
      state.outbox = state.outbox.filter((x) => x !== id);
    }
  }

  async function push() {
    for (const id of [...state.outbox]) {
      const draft = state.drafts[id];
      if (!draft) {
        state.outbox = state.outbox.filter((x) => x !== id);
        continue;
      }
      const { templateId, location, status, answers, photos, clientUpdatedAt } = draft;
      // NetworkError (după reîncercări) iese din buclă: rețeaua lipsește, coada rămâne.
      const response = await call('PUT', `/api/inspections/${id}`, {
        token: token(),
        body: { templateId, location, status, answers, photos, clientUpdatedAt }
      });

      if (response.status === 401) throw new AuthExpired();

      if (response.status === 200 || response.status === 201) {
        const server = response.body.inspection;
        state.inspections[id] = server;
        // applied=false cu același marcaj de timp = propria cerere, deja primită (retransmisie).
        // Cu alt marcaj = serverul are o modificare mai nouă de pe alt dispozitiv (R2).
        if (!response.body.applied && server.clientUpdatedAt !== clientUpdatedAt) {
          state.notices[id] = { type: 'replaced', message: MESSAGES.replaced };
          delete state.sentByMe[id];
        } else {
          state.sentByMe[id] = clientUpdatedAt;
        }
        settle(id, clientUpdatedAt);
      } else if (response.status === 409 && response.body?.inspection) {
        state.inspections[id] = response.body.inspection;
        state.notices[id] = { type: 'locked', message: MESSAGES.locked };
        delete state.sentByMe[id];
        settle(id, clientUpdatedAt);
      } else if (state.drafts[id]?.clientUpdatedAt !== clientUpdatedAt) {
        // Refuz pentru o variantă deja înlocuită local: varianta nouă rămâne în coadă și pleacă în
        // runda următoare; eroarea variantei vechi nu se mai afișează.
        again = true;
      } else {
        // 400, 403, 404, 413: o reîncercare identică ar eșua la fel. Draft-ul rămâne, cu mesajul
        // serverului, și pleacă din nou doar după o nouă modificare (R13).
        const error = response.body?.error;
        const details = error?.details?.map((d) => d.message).join('; ');
        state.errors[id] = [error?.message ?? `Eroare ${response.status}`, details].filter(Boolean).join(': ');
        state.outbox = state.outbox.filter((x) => x !== id);
      }
      await persist('inspections', 'drafts', 'outbox', 'notices', 'errors', 'sentByMe');
      emit();
    }
  }

  async function get(path) {
    const response = await call('GET', path, { token: token() });
    if (response.status === 401) throw new AuthExpired();
    if (response.status !== 200) throw new NetworkError(`Eroare ${response.status} la ${path}`);
    return response.body;
  }

  // Descarcă inspecțiile proprii și șabloanele. Detaliile (cu poze) se cer doar pentru
  // inspecțiile noi sau modificate pe server de la ultima sincronizare.
  async function pull() {
    const items = [];
    let page = 1;
    let totalPages = 1;
    do {
      const body = await get(`/api/inspections?pageSize=100&page=${page}&sort=dueDate&order=asc`);
      items.push(...body.items);
      totalPages = body.totalPages;
      page += 1;
    } while (page <= totalPages);

    // Șabloanele se schimbă rar: se descarcă la prima sincronizare, când o inspecție are un șablon
    // necunoscut sau cel mult o dată la 10 minute. Sincronizarea periodică face astfel o singură cerere.
    const known = new Set(state.templates.map((t) => t.id));
    const stale = !state.templatesAt || now().getTime() - state.templatesAt > TEMPLATES_MAX_AGE_MS;
    const templates = stale || items.some((item) => !known.has(item.templateId)) ? await get('/api/templates') : null;
    const next = {};
    const sentByMe = {};
    for (const item of items) {
      const cached = state.inspections[item.id];
      next[item.id] = cached?.updatedAt === item.updatedAt && cached.photos ? cached : await get(`/api/inspections/${item.id}`);
      // Modificarea noastră a fost acceptată, dar între timp alt dispozitiv a trimis una mai nouă:
      // spunem asta, oricare ar fi fost ordinea sincronizărilor (R2).
      const mine = state.sentByMe[item.id];
      if (mine && !state.drafts[item.id] && Date.parse(item.clientUpdatedAt) > Date.parse(mine)) {
        state.notices[item.id] = { type: 'overwritten', message: MESSAGES.overwritten };
      } else if (mine) {
        sentByMe[item.id] = mine;
      }
    }
    state.inspections = next;
    if (templates) {
      state.templates = templates;
      state.templatesAt = now().getTime();
    }
    state.sentByMe = sentByMe;
    await persist('inspections', 'templates', 'templatesAt', 'sentByMe', 'notices');
  }

  // Trimite coada, apoi descarcă starea serverului. Rulează o singură dată la un moment dat:
  // un apel în timpul unei sincronizări primește aceeași promisiune și cere o rundă în plus.
  function sync() {
    if (running) {
      again = true;
      return running;
    }
    if (!state.session) return Promise.resolve();
    running = (async () => {
      state.syncing = true;
      emit();
      try {
        // Modificările salvate în timpul unei runde se trimit într-o rundă suplimentară.
        do {
          again = false;
          await push();
          await pull();
          state.lastSync = clock().toISOString();
          state.lastError = null;
        } while (again && state.outbox.length > 0);
      } catch (error) {
        if (error instanceof AuthExpired) {
          state.authExpired = true;
          state.lastError = 'Sesiunea a expirat. Autentifică-te din nou; modificările rămân salvate.';
        } else if (error instanceof NetworkError) {
          state.lastError = error.message;
        } else {
          throw error;
        }
      } finally {
        state.syncing = false;
        await persist('lastSync');
        running = null;
        emit();
        // O cerere de sincronizare venită exact la final (după ultima verificare) nu se pierde.
        if (again && state.outbox.length > 0 && !state.lastError && !state.authExpired) {
          again = false;
          sync();
        }
      }
    })();
    return running;
  }

  async function dismissNotice(id) {
    delete state.notices[id];
    await persist('notices');
    emit();
  }

  return { init, login, logout, saveDraft, sync, dismissNotice, getInspection: view, snapshot };
}
