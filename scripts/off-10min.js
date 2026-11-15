// Rularea cu 10 minute offline (T-OFF-07, cerința din fișa temei): npm run test:off-10min
//
// Rulează testul Playwright T-OFF-01 (mod avion → editare + creare → reîncărcare → 10 minute
// fără rețea → revenire online → sincronizare automată) și salvează dovada, cu orele de start
// și de final și ieșirea completă, în docs/evidence/off-10min.md.
// Durata se poate schimba: OFFLINE_DURATION_MS (implicit 600000 = 10 minute).

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const duration = Number(process.env.OFFLINE_DURATION_MS ?? 600000);
const started = new Date();
let output = '';

console.log(`Test offline de ${duration / 60000} minute pornit la ${started.toLocaleTimeString('ro-RO')}…`);
const child = spawn(process.execPath, [`${root}node_modules/@playwright/test/cli.js`, 'test', '-g', 'T-OFF-01', '--reporter=list'], {
  cwd: root,
  env: { ...process.env, OFFLINE_DURATION_MS: String(duration), FORCE_COLOR: '0' }
});
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
}

child.on('exit', (code) => {
  const ended = new Date();
  const minutes = ((ended - started) / 60000).toFixed(1);
  writeFileSync(`${root}docs/evidence/off-10min.md`, `# Dovadă: ${duration / 60000} minute offline (T-OFF-07)

Generat automat de \`npm run test:off-10min\` (scripts/off-10min.js). Fiecare rulare rescrie acest fișier.

| | |
|---|---|
| Rezultat | ${code === 0 ? '✅ trecut' : `❌ eșuat (cod ${code})`} |
| Start | ${started.toISOString()} |
| Final | ${ended.toISOString()} (${minutes} minute) |
| Durata offline cerută | ${duration / 1000} s |
| Calculator | ${os.type()} ${os.release()}, ${os.cpus().length} nuclee, Node.js ${process.version} |

**Scenariul** (e2e/off.spec.js, T-OFF-01/03/08): login → mod avion → editarea unei inspecții asignate
și crearea uneia noi → **reîncărcarea paginii fără rețea** → ${duration / 60000} minute fără rețea → revenire
online → verificare, prin API, că ambele inspecții au ajuns pe server fără nicio acțiune manuală.

## Ieșirea testului

\`\`\`
${output.replace(/\u001b\[[0-9;]*m/g, '').trim()}
\`\`\`
`);
  console.log(`Dovada e în docs/evidence/off-10min.md (${minutes} minute).`);
  process.exit(code ?? 1);
});
