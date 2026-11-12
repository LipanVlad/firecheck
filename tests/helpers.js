import { randomUUID } from 'node:crypto';
import { createRegistrySim } from '../registry-sim/app.js';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db/index.js';
import { SEED_PASSWORDS, seedDatabase } from '../server/seed.js';

const listen = (app) => new Promise((resolve) => {
  const server = app.listen(0, () => resolve(server));
});
const urlOf = (server) => `http://localhost:${server.address().port}`;
const closeServer = (server) => new Promise((resolve) => {
  server.closeAllConnections?.();
  server.close(resolve);
});

export const REGISTRY_KEY = 'cheie-de-test';

// Pornește aplicația pe un port liber (port 0), cu o bază de date nouă în memorie și seed.
// Fiecare fișier de test primește un server izolat și îl închide la final (Cursul 05, #38).
//
// Opțiuni:
//   seed: false            → bază de date goală
//   registry: true | {...} → pornește și simulatorul Registrului PSI; pauzele de backoff sunt
//                            înregistrate în `delays` și nu se așteaptă de fapt (teste rapide)
export async function startTestServer({ seed = true, registry = false } = {}) {
  const db = await createDatabase({ storage: ':memory:' });
  const data = seed ? await seedDatabase(db) : null;

  let sim = null;
  let simServer = null;
  const delays = [];
  let registryConfig = null;
  if (registry) {
    const options = registry === true ? {} : registry;
    sim = createRegistrySim({ apiKey: REGISTRY_KEY, slowMs: options.slowMs ?? 300 });
    simServer = await listen(sim);
    registryConfig = {
      url: options.url ?? urlOf(simServer),
      apiKey: options.apiKey ?? REGISTRY_KEY,
      timeoutMs: options.timeoutMs ?? 100,
      maxAttempts: 5,
      baseDelayMs: 1000,
      maxRetryAfterMs: 600000,
      sleep: async (ms) => { delays.push(ms); },
      log: () => {}
    };
  }

  const app = createApp({ db, registry: registryConfig });
  const server = await listen(app);
  const baseUrl = urlOf(server);

  async function api(method, path, { token, body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  }

  async function login(username) {
    const password = username === 'coord' ? SEED_PASSWORDS.coordinator : SEED_PASSWORDS.inspector;
    const { status, body } = await api('POST', '/api/auth/login', { body: { username, password } });
    if (status !== 200) throw new Error(`login ${username}: ${status}`);
    return body.token;
  }

  async function simControl(method, path, body) {
    const response = await fetch(`${urlOf(simServer)}/_control/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body)
    });
    return response.status === 204 ? null : response.json();
  }

  return {
    db,
    data,
    baseUrl,
    api,
    login,
    delays,
    processor: app.locals.registryProcessor,
    registryUrl: simServer ? urlOf(simServer) : null,
    scenario: (steps) => simControl('POST', 'scenario', { steps }),
    stats: () => simControl('GET', 'stats'),
    resetSim: () => simControl('POST', 'reset'),
    async close({ dbAlreadyClosed = false } = {}) {
      await app.locals.registryProcessor.stop();
      await closeServer(server);
      if (simServer) await closeServer(simServer);
      if (!dbAlreadyClosed) await db.sequelize.close();
    }
  };
}

// Corp valid pentru PUT /api/inspections/{id}, pentru șablonul „Căi de evacuare” (5 întrebări).
export function inspectionBody(overrides = {}) {
  return {
    templateId: 2,
    location: 'Bloc Z, subsol tehnic',
    status: 'in_progress',
    answers: { q1: { value: 'pass', note: '' } },
    photos: [],
    clientUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides
  };
}

export const fullAnswers = (count = 5, value = 'pass') =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`q${i + 1}`, { value, note: '' }]));

export const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

export const newId = () => randomUUID();

// O „poză” de mărimea dată, cu semnătura reală a formatului (primii octeți), restul zerouri.
export function fakePhoto(bytes, type = 'jpeg') {
  const head = type === 'png' ? [0x89, 0x50, 0x4e, 0x47] : [0xff, 0xd8, 0xff];
  const buffer = Buffer.alloc(bytes);
  Buffer.from(head).copy(buffer);
  return `data:image/${type};base64,${buffer.toString('base64')}`;
}
