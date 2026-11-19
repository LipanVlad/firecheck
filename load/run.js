// Testul de încărcare (npm run load), docs/capacity.md.
//
// 1. creează o bază de date separată (data/load.sqlite) cu 5.000 de inspecții și 50 de inspectori;
// 2. pornește serverul în mod producție, cu METRICS=1 (procesor și memorie la fiecare secundă);
// 3. autentifică cei 50 de inspectori și pregătește datele pentru Artillery;
// 4. rulează Artillery pe 3 niveluri (5, 20, 60 cereri/s), cu pauză între ele;
// 5. scrie rezultatele, mediul de test și estimarea capacității în docs/evidence/load-results.md.
//
// Durata fiecărui nivel: LOAD_DURATION (secunde, implicit 60).
// `node load/run.js --no-indexes` (npm run load:fara-indexuri) repetă experimentul cu indexurile
// șterse din baza de date de test și scrie docs/evidence/load-results-fara-indexuri.md.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Sequelize } from 'sequelize';
import { createDatabase } from '../server/db/index.js';
import { SEED_PASSWORDS, seedDatabase } from '../server/seed.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3200;
const TARGET = `http://localhost:${PORT}`;
const DURATION = Number(process.env.LOAD_DURATION ?? 60);
const PAUSE = 10;
const INSPECTORS = 50;
const LEVELS = [
  { name: 'L1', label: 'normal', rate: 5 },
  { name: 'L2', label: 'vârf', rate: 20 },
  { name: 'L3', label: 'stres', rate: 60 }
];
const SLO = { p50: 100, p95: 300, errorRate: 0.01 };
const PEAK_RPS = 20;
const PER_INSPECTOR_RPS = 0.4;
const NO_INDEXES = process.argv.includes('--no-indexes');
const INDEXES = ['idx_inspections_inspector_updated', 'idx_inspections_status', 'idx_inspections_due_date'];
const CPU_HEADROOM = 0.7; // capacitatea estimată lasă 30% rezervă de procesor
const resultsDir = `${root}load/results`;
const reportFile = `${root}docs/evidence/${NO_INDEXES ? 'load-results-fara-indexuri.md' : 'load-results.md'}`;
const log = (message) => console.log(`[load] ${message}`);

mkdirSync(resultsDir, { recursive: true });

// 1. Baza de date
const storage = `${root}data/${NO_INDEXES ? 'load-fara-indexuri' : 'load'}.sqlite`;
log(`seed: ${INSPECTORS} inspectori, 5000 de inspecții în ${storage}`);
const db = await createDatabase({ storage });
await db.sequelize.sync({ force: true });
await seedDatabase(db, { inspectors: INSPECTORS, inspections: 5000 });
await db.sequelize.close();

// 2. Serverul
const metrics = [];
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), DB_STORAGE: storage, LOG_REQUESTS: '0', METRICS: '1', REGISTRY_API_KEY: 'load', REGISTRY_URL: 'http://127.0.0.1:9' },
  stdio: ['ignore', 'pipe', 'inherit']
});
server.stdout.on('data', (chunk) => {
  for (const line of chunk.toString().split('\n')) {
    if (line.startsWith('{"metrics"')) metrics.push(JSON.parse(line));
  }
});
const stopServer = () => server.kill();
process.on('exit', stopServer);

for (let i = 0; i < 50; i += 1) {
  try {
    if ((await fetch(`${TARGET}/api/health`)).ok) break;
  } catch {
    await sleep(200);
  }
}

if (NO_INDEXES) {
  // Serverul recreează indexurile la pornire (sequelize.sync), deci le ștergem după.
  const raw = new Sequelize({ dialect: 'sqlite', storage, logging: false });
  for (const name of INDEXES) await raw.query(`DROP INDEX IF EXISTS ${name}`);
  await raw.close();
  log(`indexuri șterse: ${INDEXES.join(', ')}`);
}

// 3. Autentificare și date pentru Artillery. Pe fiecare rând: tokenul unui inspector, o inspecție
// a lui (pentru detalii), una pe care o poate edita (pentru actualizări) și numele lui (pentru login).
const loginAs = async (username, password) => (await (await fetch(`${TARGET}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password })
})).json()).token;

const rows = ['token,inspectionId,editableId,editableTemplateId,username'];
for (let i = 1; i <= INSPECTORS; i += 1) {
  const username = `inspector${i}`;
  const token = await loginAs(username, SEED_PASSWORDS.inspector);
  const own = await (await fetch(`${TARGET}/api/inspections?pageSize=100`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const editable = own.items.filter((item) => ['assigned', 'in_progress', 'returned'].includes(item.status));
  own.items.slice(0, 20).forEach((item, n) => {
    const target = editable[n % editable.length];
    rows.push([token, item.id, target.id, target.templateId, username].join(','));
  });
}
writeFileSync(`${resultsDir}/data.csv`, `${rows.join('\n')}\n`);
const coordToken = await loginAs('coord', SEED_PASSWORDS.coordinator);
log(`${rows.length - 1} rânduri de date pregătite pentru ${INSPECTORS} inspectori + coordonator`);

// 4. Artillery, câte un nivel pe rând. Amestecul reproduce vârful de reconectare (capacity.md):
// sincronizarea listei ca în aplicație (pageSize=100), inspecții noi, actualizări ale celor
// existente, retransmisii (același PUT de două ori), poze, autentificări și ecranele coordonatorului.
const auth = { Authorization: 'Bearer {{ token }}' };
const coord = { Authorization: `Bearer ${coordToken}` };
const body = (photos) => ({ templateId: 2, location: 'Test de încărcare, nivel -1', status: 'in_progress', answers: { q1: { value: 'pass', note: '' } }, photos, clientUpdatedAt: '{{ now }}' });
const newPut = (name, photos) => ({ put: { url: '/api/inspections/{{ newId }}', headers: auth, json: body(photos), name } });
const scenarios = [
  { name: 'sincronizare', weight: 30, flow: [{ get: { url: '/api/inspections?pageSize=100&sort=dueDate&order=asc', headers: auth, name: 'GET listă (sincronizare)' } }] },
  { name: 'detalii', weight: 13, flow: [{ get: { url: '/api/inspections/{{ inspectionId }}', headers: auth, name: 'GET detalii' } }] },
  { name: 'șabloane', weight: 2, flow: [{ get: { url: '/api/templates', headers: auth, name: 'GET șabloane' } }] },
  { name: 'nouă', weight: 15, flow: [{ function: 'newInspection' }, newPut('PUT inspecție nouă', [])] },
  {
    name: 'actualizare', weight: 15, flow: [{ function: 'update' }, {
      put: {
        url: '/api/inspections/{{ editableId }}', headers: auth, name: 'PUT actualizare',
        json: { templateId: '{{ editableTemplateId }}', location: 'Actualizare în test de încărcare', status: 'in_progress', answers: { q1: { value: '{{ value }}', note: '' } }, photos: [], clientUpdatedAt: '{{ now }}' }
      }
    }]
  },
  { name: 'retransmisie', weight: 5, flow: [{ function: 'newInspection' }, newPut('PUT retransmisie', []), newPut('PUT retransmisie', [])] },
  { name: 'poză', weight: 10, flow: [{ function: 'newInspection' }, newPut('PUT cu poză', ['{{ photo }}'])] },
  { name: 'login', weight: 5, flow: [{ post: { url: '/api/auth/login', json: { username: '{{ username }}', password: SEED_PASSWORDS.inspector }, name: 'POST login' } }] },
  { name: 'raport', weight: 3, flow: [{ get: { url: '/api/report', headers: coord, name: 'GET raport (coordonator)' } }] },
  { name: 'listă coordonator', weight: 2, flow: [{ get: { url: '/api/inspections?pageSize=20&status=submitted&sort=updatedAt', headers: coord, name: 'GET listă (coordonator)' } }] }
];

const results = [];
for (const level of LEVELS) {
  const configFile = `${resultsDir}/${level.name}.config.json`;
  writeFileSync(configFile, JSON.stringify({
    config: {
      target: TARGET,
      phases: [{ duration: DURATION, arrivalRate: level.rate, name: `${level.name} ${level.label}` }],
      payload: { path: 'data.csv', fields: ['token', 'inspectionId', 'editableId', 'editableTemplateId', 'username'], skipHeader: true },
      processor: '../processor.cjs',
      plugins: { 'metrics-by-endpoint': { useOnlyRequestNames: true } }
    },
    scenarios
  }, null, 2));

  log(`${level.name} (${level.label}): ${level.rate} cereri/s timp de ${DURATION} s`);
  const start = Date.now();
  await new Promise((resolve, reject) => {
    const artillery = spawn(process.execPath, [`${root}node_modules/artillery/bin/run`, 'run', '--output', `${resultsDir}/${level.name}.json`, configFile], {
      cwd: resultsDir, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ARTILLERY_DISABLE_TELEMETRY: 'true' }
    });
    artillery.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Artillery a ieșit cu codul ${code}`))));
  });
  const end = Date.now();

  const { aggregate } = JSON.parse(readFileSync(`${resultsDir}/${level.name}.json`, 'utf8'));
  const c = aggregate.counters;
  const rt = aggregate.summaries['http.response_time'];
  const requests = c['http.requests'] ?? 0;
  const ok = Object.entries(c).filter(([k]) => /^http\.codes\.2\d\d$/.test(k)).reduce((sum, [, v]) => sum + v, 0);
  const window = metrics.filter((m) => m.t >= start && m.t <= end);
  const endpoints = Object.fromEntries(Object.entries(aggregate.summaries)
    .filter(([k]) => k.startsWith('plugins.metrics-by-endpoint.response_time.'))
    .map(([k, v]) => [k.replace('plugins.metrics-by-endpoint.response_time.', ''), v]));
  results.push({
    ...level,
    requests,
    throughput: requests / DURATION,
    codes: Object.fromEntries(Object.entries(c).filter(([k]) => /^http\.codes\.\d+$/.test(k)).map(([k, v]) => [k.slice(11), v])),
    p50: rt?.median ?? rt?.p50,
    p95: rt?.p95,
    p99: rt?.p99,
    max: rt?.max,
    errors: requests - ok + (c['vusers.failed'] ?? 0),
    cpuAvg: window.length ? window.reduce((s, m) => s + m.cpu, 0) / window.length : null,
    cpuMax: window.length ? Math.max(...window.map((m) => m.cpu)) : null,
    rssMax: window.length ? Math.max(...window.map((m) => m.rssMb)) : null,
    endpoints
  });
  if (level !== LEVELS.at(-1)) await sleep(PAUSE * 1000);
}
stopServer();

// 5. Raportul
const fmt = (n, d = 0) => (n == null || Number.isNaN(n) ? '—' : Number(n).toFixed(d));
const meets = (r) => r.p50 < SLO.p50 && r.p95 < SLO.p95 && r.errors / r.requests < SLO.errorRate;
const sustained = results.filter(meets).at(-1);
const top = results.at(-1);
const cpu = os.cpus();
const endpointNames = scenarios.flatMap((sc) => sc.flow.map((step) => Object.values(step)[0]?.name).filter(Boolean)).filter((n, i, all) => all.indexOf(n) === i);
const worst = endpointNames.filter((n) => top.endpoints[n]).sort((a, b) => top.endpoints[b].p95 - top.endpoints[a].p95)[0];

// Estimarea capacității: Node execută codul aplicației pe un singur fir, deci procesorul acelui
// fir e resursa care se epuizează prima. Din CPU-ul măsurat la cel mai mare nivel care respectă
// obiectivele, extrapolăm liniar până la 70% dintr-un nucleu (30% rezervă).
const cpuPerRps = sustained?.cpuAvg ? sustained.cpuAvg / sustained.throughput : null;
const estimate = cpuPerRps ? (CPU_HEADROOM * 100) / cpuPerRps : null;
const perRps = results.filter((r) => r.cpuAvg != null).map((r) => r.cpuAvg / r.throughput);
const trend = perRps.length > 1 && perRps.at(-1) < perRps[0] ? 'scade' : 'crește';

const report = `# Rezultatele testului de încărcare${NO_INDEXES ? ' — FĂRĂ indexuri' : ''}

Generat automat de \`${NO_INDEXES ? 'npm run load:fara-indexuri' : 'npm run load'}\` (load/run.js). Fiecare rulare rescrie acest
fișier. **Rezultatele depind de calculator** și nu se compară între calculatoare diferite.
${NO_INDEXES ? '\n**Variantă de experiment:** indexurile de pe tabela `inspections` sunt șterse din baza de date de test\n(' + INDEXES.join(', ') + '). Comparația cu rularea normală: [`load-results.md`](load-results.md).\n' : ''}
## Mediul de test

| | |
|---|---|
| Procesor | ${cpu[0]?.model ?? 'necunoscut'} (${cpu.length} nuclee logice) |
| Memorie RAM | ${(os.totalmem() / 1073741824).toFixed(1)} GB |
| Sistem de operare | ${os.type()} ${os.release()} (${os.platform()}/${os.arch()}) |
| Node.js | ${process.version} |
| Data rulării | ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC |
| Date | 5.000 de inspecții, 50 de inspectori, 1 coordonator; SQLite pe disc (WAL) |
| Durata unui nivel | ${DURATION} s, cu ${PAUSE} s de pauză între niveluri |
| Generatorul de trafic | Artillery, pe același calculator cu serverul (îi ia și el din procesor) |

## Amestecul de cereri

| Scenariu | Pondere | Ce reproduce |
|---|---:|---|
| GET listă (sincronizare) | 30% | descărcarea inspecțiilor proprii după reconectare, ca în aplicație (\`pageSize=100\`) |
| GET detalii | 13% | descărcarea unei inspecții modificate |
| GET șabloane | 2% | descărcarea șabloanelor (la prima sincronizare și cel mult o dată la 10 minute) |
| PUT inspecție nouă | 15% | o inspecție creată offline, trimisă la reconectare |
| PUT actualizare | 15% | o nouă modificare a unei inspecții existente (marcaj de timp nou; conflicte rezolvate cu R2) |
| PUT retransmisie | 5% | același PUT trimis de două ori (răspuns pierdut); al doilea primește \`applied: false\` |
| PUT cu poză | 10% | inspecție nouă cu o poză de ~100 KB |
| POST login | 5% | autentificare (hash scrypt, cea mai scumpă operație pentru procesor) |
| GET raport, GET listă (coordonator) | 5% | ecranele coordonatorului |

## Rezultate pe niveluri

| Nivel | Cereri/s țintă | Cereri/s reale | Cereri | p50 (ms) | p95 (ms) | p99 (ms) | Erori | CPU mediu / maxim | Memorie maximă | Obiectiv (SLO) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
${results.map((r) => `| ${r.name} ${r.label} | ${r.rate} | ${fmt(r.throughput, 1)} | ${r.requests} | ${fmt(r.p50, 1)} | ${fmt(r.p95, 1)} | ${fmt(r.p99, 1)} | ${r.errors} (${fmt((r.errors / r.requests) * 100, 2)}%) | ${fmt(r.cpuAvg)}% / ${fmt(r.cpuMax)}% | ${fmt(r.rssMax)} MB | ${meets(r) ? '✅' : '❌'} |`).join('\n')}

Obiective (docs/capacity.md, secțiunea 4): p50 < ${SLO.p50} ms, p95 < ${SLO.p95} ms, erori < ${SLO.errorRate * 100}%.
CPU: procentul dintr-un nucleu folosit de procesul Node al serverului (100% = un nucleu plin; poate trece de 100%,
pentru că include și thread pool-ul în care rulează hash-urile scrypt).
Coduri HTTP la ${top.name}: ${Object.entries(top.codes).map(([k, v]) => `${k}: ${v}`).join(', ')}.

## p95 pe tipuri de cereri (ms)

| Tip | ${results.map((r) => r.name).join(' | ')} |
|---|${results.map(() => '---:').join('|')}|
${endpointNames.map((n) => `| ${n} | ${results.map((r) => fmt(r.endpoints[n]?.p95, 1)).join(' | ')} |`).join('\n')}

## Estimarea capacității

${sustained
    ? `- **Măsurat:** obiectivele sunt respectate până la **${fmt(sustained.throughput, 1)} cereri/s** (nivelul ${sustained.name}).
- **Estimat:** la ${sustained.name}, procesorul serverului a lucrat ${fmt(sustained.cpuAvg)}% dintr-un nucleu, adică ~${fmt(cpuPerRps, 2)}% per cerere/s. Extrapolat liniar până la ${CPU_HEADROOM * 100}% dintr-un nucleu, capacitatea susținută estimată e **~${fmt(estimate)} cereri/s**.
- **Inspectori deserviți la vârf:** ≈ ${fmt(estimate)} / ${PER_INSPECTOR_RPS} ≈ **${fmt(estimate / PER_INSPECTOR_RPS)} inspectori** (măsurat sigur: ${Math.floor(sustained.throughput / PER_INSPECTOR_RPS)}).
- **Față de obiectivul scenariului** (${PEAK_RPS} cereri/s la vârf): marjă măsurată **${fmt(sustained.throughput / PEAK_RPS, 1)}×**, estimată **${fmt(estimate / PEAK_RPS, 1)}×**.
- **Procesor per cerere/s, pe niveluri:** ${results.map((r) => `${r.name} ${fmt(r.cpuAvg / r.throughput, 2)}%`).join(' → ')}. ${trend === 'scade' ? 'Scade odată cu sarcina (costurile fixe ale procesului, ca temporizatoarele și colectarea memoriei, se împart la mai multe cereri), deci extrapolarea de la cel mai mare nivel e prudentă.' : 'Crește odată cu sarcina, deci extrapolarea liniară poate supraestima capacitatea.'}
- **Limitele estimării:** e o extrapolare, nu o măsurătoare; presupune că nu apare alt blocaj înainte (de exemplu scrierile serializate în SQLite) și variază de la o rulare la alta (de ordinul ±20%). Punctul real de saturare nu e căutat: experimentul de saturare e cerut doar de pachetul SCL.`
    : `- Niciun nivel nu respectă obiectivele pe acest calculator${NO_INDEXES ? ' fără indexuri' : ''}. Capacitatea susținută e sub ${results[0].rate} cereri/s sau între niveluri; vezi blocajul de mai jos.`}

## Blocaj probabil

- **Procesor:** ${results.map((r) => `${r.name} ${fmt(r.cpuAvg)}%`).join(' → ')} (mediu, dintr-un nucleu).${results.every((r) => r.cpuAvg != null) ? (results.at(-1).cpuAvg > 85 ? ' Firul principal Node e aproape plin: el e blocajul.' : ' Crește odată cu sarcina; e resursa care se va epuiza prima (Node rulează codul aplicației pe un singur fir).') : ''}
- **Cele mai lente cereri** la ${top.name}: **${worst}** (p95 ${fmt(top.endpoints[worst]?.p95, 1)} ms).
- **Interpretare:** ${worst === 'POST login'
    ? 'autentificarea e lentă intenționat: hash-ul scrypt consumă procesor ca să încetinească ghicirea parolelor. Rulează în thread pool-ul libuv, nu pe firul principal, dar ia din același procesor ca restul cererilor.'
    : worst?.startsWith('PUT')
      ? 'scrierile sunt serializate (o singură scriere SQLite la un moment dat, prin `db.write()`), iar corpurile mari (poze) se parsează pe firul principal.'
      : 'citirile domină: fără indexuri potrivite, fiecare listare citește mult din tabel.'}
`;
writeFileSync(reportFile, report);
log(`rezultatele sunt în ${reportFile.replace(root, '')}`);
process.exit(0);
