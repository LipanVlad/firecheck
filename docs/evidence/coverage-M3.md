# Coverage M3 (backend, final)

Comandă: `npm run build && npm run coverage` (c8, configurat în `.c8rc.json`; eșuează sub praguri).
Build-ul e necesar pentru ca livrarea aplicației React de către server să fie și ea acoperită.

| | |
|---|---|
| Sistem | Linux (mediu de dezvoltare), 2 nuclee, 8 GB RAM |
| Node.js | 22.23 (testele trec și pe 24 și 26) |
| Data | 11.11.2026 |

**Praguri:** ≥ 70% statements, ≥ 60% branches. **Rezultat: 98,4% statements, 95,4% branches.**
Teste: 197 trecute, 0 eșuate (`npm test`), plus 11 teste Playwright (`npm run test:e2e`).

```
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
All files          |   98.35 |    95.37 |   94.66 |   98.35 |                   
 server            |   92.55 |     90.9 |      60 |   92.55 |                   
  app.js           |   92.55 |     90.9 |      60 |   92.55 | 59-65             
 server/db         |     100 |    85.71 |     100 |     100 |                   
  index.js         |     100 |    77.77 |     100 |     100 | 20-27             
  models.js        |     100 |      100 |     100 |     100 |                   
 server/domain     |     100 |    97.91 |     100 |     100 |                   
  answers.js       |     100 |      100 |     100 |     100 |                   
  conflict.js      |     100 |      100 |     100 |     100 |                   
  dto.js           |     100 |    93.75 |     100 |     100 | 27                
  stateMachine.js  |     100 |      100 |     100 |     100 |                   
 server/middleware |     100 |    94.28 |     100 |     100 |                   
  auth.js          |     100 |      100 |     100 |     100 |                   
  errors.js        |     100 |    92.85 |     100 |     100 | 21                
  validate.js      |     100 |    85.71 |     100 |     100 | 7                 
 server/registry   |      99 |    93.05 |    87.5 |      99 |                   
  backoff.js       |     100 |      100 |     100 |     100 |                   
  client.js        |     100 |      100 |     100 |     100 |                   
  processor.js     |    98.6 |     87.5 |   83.33 |    98.6 | 108-109           
 server/routes     |    97.6 |    96.51 |     100 |    97.6 |                   
  auth.js          |    91.3 |    93.33 |     100 |    91.3 | 36-38,48-52       
  inspections.js   |     100 |      100 |     100 |     100 |                   
  report.js        |     100 |    95.23 |     100 |     100 | 70                
  templates.js     |     100 |      100 |     100 |     100 |                   
  users.js         |     100 |      100 |     100 |     100 |                   
 server/security   |     100 |      100 |     100 |     100 |                   
  passwords.js     |     100 |      100 |     100 |     100 |                   
  tokens.js        |     100 |      100 |     100 |     100 |                   
 server/services   |   98.54 |     97.1 |     100 |   98.54 |                   
  inspections.js   |   98.54 |     97.1 |     100 |   98.54 | 88-89             
-------------------|---------|----------|---------|---------|-------------------
```

**Excluderi** (motivate în [`testing.md`](../testing.md#2-coverage)): `server/index.js`,
`server/config.js`, `server/seed.js`, `registry-sim/`, `client/` (frontend-ul e verificat prin
testele Playwright și prin testele modulului de sincronizare din `tests/client/`).

## Funcționalități insuficient testate și riscuri

| Zonă | Ce lipsește | Risc |
|---|---|---|
| `app.js` 59–65: jurnalul de cereri | activ doar cu `LOG_REQUESTS=1` | mic; verificat manual la `npm start` |
| `db/index.js` 20–27: baza de date pe disc | testele folosesc memoria | mic; folosită de `npm run seed`, `npm start` și testul de încărcare |
| `routes/auth.js` 36–38: expirarea ferestrei de 15 minute a limitei de login | testul ar trebui să aștepte 15 minute | mic: logica e o simplă comparație de timp |
| `routes/auth.js` 48–52: curățarea contoarelor peste 10.000 de intrări | ar cere 10.000 de încercări eșuate | mic: protejează doar memoria; limita de login funcționează și fără ea |
| `registry/processor.js` 108–109: eșecul marcării unei trimiteri ca `failed` | ar cere o bază de date care cade în mijlocul tratării unei erori | mic |
| `registry/processor.js`: pauza programată după un restart | testată (rămâne `pending` cât așteaptă) | — |
| Componentele React | fără teste de componentă; acoperite doar prin Playwright | mediu: o eroare de afișare într-un ecran netestat de Playwright (de ex. creare de șablon, raport filtrat) ar trece neobservată |
| Actualizarea service worker-ului între versiuni | netestată automat | mediu: un utilizator offline poate rula o versiune veche a aplicației până la următoarea conexiune |
| Mai multe tab-uri deschise pe același dispozitiv | prevenit: un singur tab activ (T-OFF-11) | mic: doar în browserele fără Web Locks API |
| Reîncercarea periodică la 30 s | testată în browser (T-OFF-09), dar nu și oprirea ei la delogare | mic |
| Compresia pozelor (`client/src/lib/photos.js`) | depinde de canvas, netestată automat | mic: limita de 200 KB și semnătura fișierului sunt verificate oricum pe server (T-VAL-06) |
