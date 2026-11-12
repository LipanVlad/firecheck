// Demonstrație pentru pachetul EXT (npm run demo:ext).
// Pornește, într-un singur proces, aplicația (bază de date în memorie + seed) și simulatorul
// Registrului PSI, apoi aprobă o inspecție cu un scenariu care combină toate tipurile de eșec.
// Pauzele sunt reale (scurtate față de producție), ca să se vadă cronologia.

import { randomUUID } from 'node:crypto';
import { createRegistrySim } from '../registry-sim/app.js';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db/index.js';
import { seedDatabase } from '../server/seed.js';

const KEY = 'cheie-demo';
const SCENARIO = ['timeout', 'rate_limit', 'error_503', 'lost_response', 'ok'];
const start = Date.now();
const stamp = () => `+${((Date.now() - start) / 1000).toFixed(2)}s`.padStart(8);
const say = (text) => console.log(`${stamp()}  ${text}`);
const listen = (app) => new Promise((resolve) => { const server = app.listen(0, () => resolve(server)); });

const db = await createDatabase({ storage: ':memory:' });
await seedDatabase(db, { inspections: 0, inspectors: 1 });

const simServer = await listen(createRegistrySim({ apiKey: KEY, slowMs: 2000, retryAfterSeconds: 3 }));
const simUrl = `http://localhost:${simServer.address().port}`;
const app = createApp({
  db,
  registry: { url: simUrl, apiKey: KEY, timeoutMs: 1000, baseDelayMs: 500, maxAttempts: 5, maxRetryAfterMs: 600000, log: (m) => say(`server: ${m.replace(/^[0-9a-f-]{36}: /, '')}`) }
});
const server = await listen(app);
const base = `http://localhost:${server.address().port}/api`;

const call = async (method, path, token, body) => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body)
  });
  return response.json();
};
const login = async (username, password) => (await call('POST', '/auth/login', null, { username, password })).token;

console.log('Demonstrație pachet EXT: Registrul PSI cu eșecuri simulate');
console.log(`Scenariu simulator: ${SCENARIO.join(' → ')}`);
console.log('Setări: timeout 1 s, backoff 0,5 s → 1 s → 2 s → 4 s, maximum 5 încercări; Registrul cere Retry-After: 3 s la 429\n');

await fetch(`${simUrl}/_control/scenario`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steps: SCENARIO }) });

const inspector = await login('inspector1', 'insp123');
const coordinator = await login('coord', 'coord123');
const id = randomUUID();
const answers = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`q${n}`, { value: n === 3 ? 'fail' : 'pass', note: '' }]));
await call('PUT', `/inspections/${id}`, inspector, {
  templateId: 2, location: 'Mall Vitan, parcare -2', status: 'submitted', answers, photos: [], clientUpdatedAt: new Date().toISOString()
});
say(`inspectorul a trimis inspecția ${id.slice(0, 8)}… spre revizie`);

const approved = await call('POST', `/inspections/${id}/review`, coordinator, { decision: 'approve' });
say(`coordonatorul a aprobat → status „${approved.status}”, trimitere „${approved.registry.status}”`);

await app.locals.registryProcessor.idle();
const final = await call('GET', `/inspections/${id}`, coordinator);
await new Promise((resolve) => setTimeout(resolve, 2200)); // lasă cererea „lentă” să se termine pe simulator
const stats = await (await fetch(`${simUrl}/_control/stats`)).json();

console.log('\nRezultat');
console.log(`  stare trimitere:        ${final.registry.status}`);
console.log(`  încercări:              ${final.registry.attempts}`);
console.log(`  chitanță:               ${final.registry.receiptNo}`);
console.log(`  cereri primite de Registru:   ${stats.requests}`);
console.log(`  înregistrări în Registru:     ${stats.registrations}  (trebuie să fie 1)`);

server.closeAllConnections();
simServer.closeAllConnections();
server.close();
simServer.close();
await db.sequelize.close();
process.exit(final.registry.status === 'sent' && stats.registrations === 1 ? 0 : 1);
