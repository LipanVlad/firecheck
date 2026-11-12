# Coverage M2 (backend)

Comandă: `npm run coverage` (c8, configurat în `.c8rc.json`; eșuează sub praguri).

| | |
|---|---|
| Sistem | Linux (mediu de dezvoltare), 2 nuclee, 8 GB RAM |
| Node.js | 22.23 |
| Data | 11.11.2026 |

**Praguri:** ≥ 70% statements, ≥ 60% branches. **Rezultat:** ambele depășite.

Teste: 155 trecute, 0 eșuate (`npm test`).

```
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
All files          |   98.82 |     94.4 |   94.02 |   98.82 |                   
 server            |   86.84 |    83.33 |      60 |   86.84 |                   
  app.js           |   86.84 |    83.33 |      60 |   86.84 | 42-48,69-71       
 server/db         |     100 |    85.71 |     100 |     100 |                   
  index.js         |     100 |    77.77 |     100 |     100 | 20-27             
  models.js        |     100 |      100 |     100 |     100 |                   
 server/domain     |     100 |    97.61 |     100 |     100 |                   
  answers.js       |     100 |      100 |     100 |     100 |                   
  conflict.js      |     100 |      100 |     100 |     100 |                   
  dto.js           |     100 |    93.75 |     100 |     100 | 27                
  stateMachine.js  |     100 |      100 |     100 |     100 |                   
 server/middleware |     100 |    94.28 |     100 |     100 |                   
  auth.js          |     100 |      100 |     100 |     100 |                   
  errors.js        |     100 |    92.85 |     100 |     100 | 21                
  validate.js      |     100 |    85.71 |     100 |     100 | 7                 
 server/registry   |     100 |    87.93 |   85.71 |     100 |                   
  backoff.js       |     100 |      100 |     100 |     100 |                   
  client.js        |     100 |       95 |     100 |     100 | 39                
  processor.js     |     100 |    82.35 |   81.81 |     100 | 40-42,58-64,91    
 server/routes     |     100 |    98.41 |     100 |     100 |                   
  auth.js          |     100 |      100 |     100 |     100 |                   
  inspections.js   |     100 |      100 |     100 |     100 |                   
  report.js        |     100 |    95.23 |     100 |     100 | 68                
  templates.js     |     100 |      100 |     100 |     100 |                   
 server/security   |     100 |      100 |     100 |     100 |                   
  passwords.js     |     100 |      100 |     100 |     100 |                   
  tokens.js        |     100 |      100 |     100 |     100 |                   
 server/services   |   98.54 |     97.1 |     100 |   98.54 |                   
  inspections.js   |   98.54 |     97.1 |     100 |   98.54 | 88-89             
-------------------|---------|----------|---------|---------|-------------------
```

**Excluderi** (motivate în [`testing.md`](../testing.md#2-coverage)): `server/index.js`,
`server/config.js`, `server/seed.js`, `registry-sim/`, `client/`.

**Ce rămâne neacoperit și de ce:**

| Fișier, linii (ramuri) | Ce e | Risc |
|---|---|---|
| `app.js` 42–48 | jurnalul de cereri, activ doar în rularea normală (`LOG_REQUESTS=1`) | mic; verificat manual la `npm start` |
| `app.js` 69–71 | livrarea aplicației React după `npm run build` | se testează în M3, prin testele E2E |
| `db/index.js` 20–27 | ramura pentru bază de date pe disc (testele folosesc memoria) | mic; verificat la `npm run seed` și `npm start` |
| `registry/processor.js` 40–42 | ramuri din construirea raportului pentru Registru (întrebare fără răspuns, observație lipsă) | mic |
| `registry/processor.js` 58–64 | așteptarea pauzei programate înainte de un restart (`nextAttemptAt` în viitor) | mediu: reluarea după restart e testată (T-EXT-10), dar fără o pauză încă activă |
| `registry/processor.js` 91 | oprirea procesorului în timpul unei pauze | mic |
| `services/inspections.js` 88–89 | verificare defensivă: prin API nu se poate ajunge aici (statusurile permise inspectorului sunt deja filtrate de Joi și de blocare) | mic; mașina de stări e testată complet prin teste de unitate |
