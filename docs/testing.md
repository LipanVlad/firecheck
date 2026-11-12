# Plan de teste — FireCheck

## 1. Strategie

| Nivel | Instrument | Ce acoperă | Comandă |
|---|---|---|---|
| Unitate | `node:test` | reguli de business pure: mașina de stări, regula de conflict, validarea răspunsurilor, politica de reîncercare, hash-ul parolelor, modulul de sincronizare al clientului | `npm test` |
| Integrare (API + persistență) | `node:test` + `fetch`, server real pe portul 0, SQLite în memorie | fluxuri, permisiuni, validări, invariante, constrângeri ale bazei de date, filtrare/sortare/paginare | `npm test` |
| Pachetul EXT | `node:test` + simulatorul Registrului pornit pe port liber | timeout, erori, 429, răspunsuri duplicate, reîncercări, stări | `npm test` |
| End-to-end + pachetul OFF | Playwright (Chromium), pe build-ul de producție | flux complet în browser, mod avion, reîncărcare, restart, retransmisii, conflict | `npm run test:e2e` |
| Coverage backend | `c8` | statements și branches pentru `server/` | `npm run coverage` |
| Încărcare | Artillery | 3 niveluri de încărcare (vezi [`capacity.md`](capacity.md)) | `npm run load`, `npm run load:fara-indexuri` |
| 10 minute offline | Playwright | T-OFF-07, cu dovadă generată automat | `npm run test:off-10min` |

**Unde sunt testele:** `tests/unit/` (reguli pure), `tests/api/` (integrare prin HTTP),
`tests/ext/` (pachetul EXT, cu simulatorul Registrului), `tests/client/` (modulul de sincronizare
al clientului), `e2e/` (Playwright), `load/` (Artillery).

Pentru Playwright, browserul se instalează o singură dată: `npx playwright install chromium`.

**Principii:**
- Fiecare test de integrare pornește un server nou cu o bază de date nouă în memorie, plus seed
  determinist. Testele nu depind unele de altele.
- Testele de integrare trec prin HTTP real (Cursul 05, #38). Se verifică perechi succes/eșec
  (Cursul 05, #39).
- Invariantele se verifică **și în starea persistată**, nu doar în răspuns (de exemplu numărul de
  rânduri din baza de date după 5 retransmisii).
- Testele EXT folosesc scenarii fixe ale simulatorului și pauze de backoff scurtate prin
  configurare. Rezultatele sunt deterministe.
- Testele OFF rulează pe build-ul de producție, singurul în care service worker-ul e activ.

---

## 2. Coverage

| Indicator | Prag | Unde e setat |
|---|---|---|
| Statements | ≥ 70% | [`.c8rc.json`](../.c8rc.json): `npm run coverage` eșuează sub prag |
| Branches | ≥ 60% | [`.c8rc.json`](../.c8rc.json) |

Raportul se generează în `coverage/` (text în consolă + HTML). Pentru predare, rezumatul se
salvează în `docs/evidence/coverage-M2.md` și, la final, `docs/evidence/coverage-M3.md`.

**Excluderi documentate:**

| Exclus | Motiv |
|---|---|
| `server/index.js` | doar pornește serverul (logica e în `app.js`, care e testat) |
| `server/config.js` | doar citește variabile de mediu |
| `server/seed.js` | generator de date sintetice, nu logică a aplicației |
| `registry-sim/` | substitut al unui sistem extern; e verificat indirect prin testele EXT, dar nu e cod al aplicației |
| `client/` | cod frontend; specificația cere coverage pentru backend. Frontend-ul e verificat prin testele E2E și OFF. |
| `node_modules/`, migrări | dependențe și configurație |

**Starea finală (M3):** 197 de teste `node:test` și 11 teste Playwright trec; coverage-ul backend
e în raportul de mai jos. Rapoarte: [`evidence/coverage-M3.md`](evidence/coverage-M3.md)
(final, cu analiza lacunelor) și [`evidence/coverage-M2.md`](evidence/coverage-M2.md).

---

## 3. Cazuri de test

Legendă tip: **U** = unitate, **I** = integrare, **E** = end-to-end (Playwright).
Etapa = când e implementat testul.

### Autentificare

| ID | Tip | Test | Rezultat așteptat | Etapa |
|---|---|---|---|---|
| T-AUTH-01 | I | login cu date corecte | 200 + token | **M2 ✔** |
| T-AUTH-02 | I | parolă greșită / utilizator inexistent | 401, același mesaj în ambele cazuri | **M2 ✔** |
| T-AUTH-03 | I | rută protejată fără token / cu token invalid | 401 | **M2 ✔** |
| T-AUTH-04 | I | token expirat | 401 | **M2 ✔** |
| T-AUTH-05 | I | după logout, tokenul vechi | 401 | **M2 ✔** |
| T-AUTH-06 | U | hash-ul parolei: aceeași parolă dă hash-uri diferite (sare), verificarea merge | ✔ | **M2 ✔** |
| T-AUTH-07 | I | răspunsurile de login și `/api/me` nu conțin parola sau hash-ul ei | ✔ | **M2 ✔** |

### Securitate (R14, antete)

| ID | Tip | Test | Rezultat așteptat | Etapa |
|---|---|---|---|---|
| T-SEC-01 | I | antetele de securitate, inclusiv CSP fără `unsafe-inline` | prezente pe răspunsuri | **M3 ✔** |
| T-SEC-02 | I | 11 parole greșite pentru același cont | al 11-lea → 429 cu `Retry-After`; alt cont nu e afectat | **M3 ✔** |
| T-SEC-03 | I | un login reușit după 9 eșecuri | contorul se resetează | **M3 ✔** |
| T-SEC-04 | I | timpul de răspuns pentru cont existent vs. inexistent | comparabil (ambele verifică un hash scrypt) | **M3 ✔** |
| T-SEC-05 | I | 50 de parole greșite pe 50 de conturi diferite, de la aceeași adresă | următoarea încercare → 429, pentru orice cont | **M3 ✔** |

### Permisiuni (R5)

| ID | Tip | Test | Rezultat așteptat | Etapa |
|---|---|---|---|---|
| T-PERM-01 | I | inspectorul creează un șablon | 403 | **M2 ✔** |
| T-PERM-02 | I | inspectorul creează o asignare | 403 | **M2 ✔** |
| T-PERM-03 | I | inspectorul aprobă sau returnează | 403 | **M2 ✔** |
| T-PERM-04 | I | inspectorul cere raportul | 403 | **M2 ✔** |
| T-PERM-05 | I | coordonatorul face `PUT` pe o inspecție | 403 | **M2 ✔** |
| T-PERM-06 | I | inspectorul cere reîncercarea trimiterii la Registru | 403 | **M2 ✔** |
| T-PERM-07 | I | inspectorul cere lista inspectorilor | 403; coordonatorul o primește fără date sensibile | **M3 ✔** |

### Confidențialitate (R4)

| ID | Tip | Test | Rezultat așteptat | Etapa |
|---|---|---|---|---|
| T-PRIV-01 | I | inspectorul A listează inspecțiile (și cu `inspectorId` al lui B) | doar ale lui A | **M2 ✔** |
| T-PRIV-02 | I | A cere detaliile unei inspecții a lui B | 404 | **M2 ✔** |
| T-PRIV-03 | I | A face `PUT` pe ID-ul unei inspecții a lui B | 404, datele lui B neschimbate în BD | **M2 ✔** |

### Validare (R7, R8)

| ID | Tip | Test | Rezultat așteptat | Etapa |
|---|---|---|---|---|
| T-VAL-01 | I | corp care nu e JSON valid | 400 | **M1 ✔** |
| T-VAL-02 | I | ID care nu e UUID | 400 | **M2 ✔** |
| T-VAL-03 | I | lipsește `templateId` sau `location` | 400 | **M2 ✔** |
| T-VAL-04 | I | valoare de răspuns în afara `pass`/`fail`/`na` | 400 | **M2 ✔** |
| T-VAL-05 | I | răspuns la o întrebare care nu există în șablon | 400 | **M2 ✔** |
| T-VAL-06 | I | 4 poze, o poză peste 200 KB, alt tip decât JPEG/PNG sau conținut care nu are semnătura tipului declarat | 400 | **M3 ✔** |
| T-VAL-07 | I | schimbarea `templateId` la o inspecție existentă | 400 | **M2 ✔** |
| T-VAL-08 | I | `clientUpdatedAt` cu 10 minute în viitor | 400 | **M2 ✔** |
| T-VAL-09 | I | șablon fără întrebări / nume prea scurt | 400 | **M2 ✔** |
| T-VAL-10 | I | corp peste 1 MB | 413 | **M2 ✔** |
| T-VAL-11 | I | parametri de listare invalizi (`sort=parola`, `pageSize=1000`) | 400 | **M2 ✔** |
| T-VAL-12 | I | rută API inexistentă | 404, format comun de eroare | **M1 ✔** |
| T-VAL-13 | I | eroare neprevăzută | 500 generic, fără detalii interne | **M1 ✔** |

### Fluxul cu stări (R3, R6)

| ID | Tip | Test | Rezultat așteptat | Etapa |
|---|---|---|---|---|
| T-STATE-01 | U | toate tranzițiile permise din tabelul din `requirements.md` | acceptate | **M2 ✔** |
| T-STATE-02 | U | toate celelalte combinații (stare, țintă, actor) | respinse | **M2 ✔** |
| T-STATE-03 | I | trimitere spre revizie cu întrebări fără răspuns | 400 | **M2 ✔** |
| T-STATE-04 | I | inspectorul modifică o inspecție `submitted` / `approved` | 409 `INSPECTION_LOCKED` + starea serverului | **M2 ✔** |
| T-STATE-05 | I | revizie pe o inspecție care nu e `submitted` (inclusiv a doua aprobare) | 409 `INVALID_TRANSITION` | **M2 ✔** |
| T-STATE-06 | I | returnare fără comentariu | 400 | **M2 ✔** |
| T-STATE-07 | I | inspecție returnată: inspectorul o editează și o retrimite | `in_progress` → `submitted` | **M2 ✔** |
| T-STATE-08 | I | BD respinge un status inexistent, chiar ocolind codul | eroare `CHECK` | **M1 ✔** |

### Invariante: duplicate și conflicte (R1, R2)

| ID | Tip | Test | Rezultat așteptat | Etapa |
|---|---|---|---|---|
| T-IDEM-01 | I | același `PUT` trimis de 5 ori, secvențial | 1 rând în BD; primul răspuns 201, restul 200 `applied: false` | **M2 ✔** |
| T-IDEM-02 | I | același `PUT` trimis de 5 ori simultan | 1 rând în BD, niciun 500 | **M2 ✔** |
| T-IDEM-03 | I | BD respinge a doua inserare cu același UUID | eroare de unicitate | **M1 ✔** |
| T-CONF-01 | U | funcția de decizie: mai nou → aplică; mai vechi sau egal → ignoră | ✔ | **M2 ✔** |
| T-CONF-02 | I | `PUT` nou (t=10), apoi `PUT` vechi (t=5) | rămâne t=10; al doilea are `applied: false` | **M2 ✔** |
| T-CONF-03 | I | `PUT` vechi (t=5), apoi `PUT` nou (t=10) | rămâne t=10 | **M2 ✔** |
| T-CONF-04 | I | două `PUT` cu același `clientUpdatedAt` și conținut diferit | rămâne primul | **M2 ✔** |
| T-CONF-05 | I | duplicat al cererii care a trimis inspecția spre revizie | 200 `applied: false`, nu 409 | **M2 ✔** |

### Fluxuri complete, filtrare, raport

| ID | Tip | Test | Rezultat așteptat | Etapa |
|---|---|---|---|---|
| T-FLOW-01 | I | F1 + F3: asignare → completare → trimitere → aprobare → trimitere `sent` la Registru | stări corecte la fiecare pas | **M2 ✔** |
| T-FLOW-02 | I | inspecție neplanificată | apare la inspector și la coordonator | **M2 ✔** |
| T-FLOW-03 | I | returnare → reeditare → retrimitere → aprobare | ✔ | **M2 ✔** |
| T-LIST-01 | I | filtrare după status, inspector, text (inclusiv diacritice; `%` și `_` luate literal), termen | doar rezultatele potrivite | **M3 ✔** |
| T-LIST-02 | I | sortare după fiecare câmp, în ambele sensuri | ordinea corectă | **M2 ✔** |
| T-LIST-03 | I | paginare: 40 de inspecții, `pageSize=15` | 3 pagini, fără repetări sau lipsuri, `total` = 40 | **M2 ✔** |
| T-REP-01 | I | raportul reflectă statusurile, neconformitățile și trimiterile | valori calculate corect pe seed | **M2 ✔** |
| T-REP-02 | I | raport filtrat doar cu `to` sau doar cu `from` | 200 | **M3 ✔** |
| T-DB-01 | I | inspecție cu inspector inexistent | eroare de cheie străină | **M1 ✔** |
| T-DB-02 | I | a doua trimitere la Registru pentru aceeași inspecție | eroare de unicitate | **M1 ✔** |
| T-DB-03 | I | aprobarea și crearea trimiterii sunt atomice (eroare provocată după schimbarea statusului) | nici statusul, nici trimiterea nu rămân salvate | **M2 ✔** |

### Pachetul EXT

Simulatorul pornește pe un port liber; fiecare test își setează scenariul.

| ID | Scenariu simulator | Rezultat așteptat | Etapa |
|---|---|---|---|
| T-EXT-01 | `ok` | `sent`, chitanță, 1 încercare | **M2 ✔** |
| T-EXT-02 | `timeout`, `ok` | `sent` după 2 încercări; 1 înregistrare în simulator | **M2 ✔** |
| T-EXT-03 | `lost_response`, `ok` | a doua încercare primește 200 `duplicate`; `sent`; 1 înregistrare, aceeași chitanță | **M2 ✔** |
| T-EXT-04 | `error_503`, `error_500`, `ok` | `sent` după 3 încercări | **M2 ✔** |
| T-EXT-05 | `rate_limit`, `ok` | a doua încercare are loc după ≥ `Retry-After`; `sent` | **M2 ✔** |
| T-EXT-06 | `error_503` × 5 | `failed` după exact 5 cereri; `lastError` completat; nicio a 6-a cerere | **M2 ✔** |
| T-EXT-07 | `bad_request` | `failed` după exact 1 cerere | **M2 ✔** |
| T-EXT-08 | după T-EXT-06: reîncercare manuală + `ok` | `pending` → `sent` | **M2 ✔** |
| T-EXT-09 | aceeași trimitere procesată de două ori în paralel | 1 înregistrare, 1 chitanță | **M2 ✔** |
| T-EXT-10 | restart de server cu trimiteri `pending` și `sending` | la pornire sunt reluate și ajung `sent` | **M2 ✔** |
| T-EXT-11 | dublu click pe „Aprobă” (două cereri) | a doua 409; o singură trimitere | **M2 ✔** |
| T-EXT-12 | Registrul oprit complet (conexiune refuzată) | după 5 încercări `failed`; inspecția rămâne `approved` | **M2 ✔** |
| T-EXT-13 | U: calculul backoff; `Retry-After` respectat și peste 30 s, plafonat la 10 minute | ✔ | **M3 ✔** |
| T-EXT-14 | excepție neprevăzută în timpul trimiterii | `failed`, cu mesajul erorii (nu rămâne în `sending`) | **M3 ✔** |
| T-EXT-15 | `rate_limit_no_header` × 2, apoi `ok` | backoff normal (1 s, 2 s), nu reîncercări imediate | **M3 ✔** |
| — | restart cu o pauză programată în viitor | trimiterea rămâne `pending` cât așteaptă | **M3 ✔** |
| — | U: `Retry-After` ca secunde, dată HTTP, lipsă sau invalid | ✔ | **M3 ✔** |

### Pachetul OFF

**Modulul de sincronizare** (`tests/client/sync.test.js`: rulează în Node, cu stocare în memorie în
loc de IndexedDB și o rețea care se poate „opri”, contra serverului real):

| ID | Test | Rezultat așteptat | Etapa |
|---|---|---|---|
| T-SYNC-01 | eroare de rețea, apoi succes | reîncearcă după 500 ms și reușește | **M3 ✔** |
| T-SYNC-02 | timeout la fiecare încercare | se oprește după exact 3 încercări | **M3 ✔** |
| T-SYNC-03 | răspunsul primului `PUT` se pierde, apoi reîncercare | 200 `applied: false` cu același marcaj → 1 rând, coada goală, **fără** mesaj de conflict | **M3 ✔** |
| T-SYNC-04 | 409 `INSPECTION_LOCKED` (trimisă de pe alt dispozitiv) | se preia starea serverului; mesaj de conflict; coada goală | **M3 ✔** |
| T-SYNC-05 | 400 | draft-ul rămâne, cu mesajul serverului; nu se mai retrimite | **M3 ✔** |
| T-SYNC-06 | 401 (sesiune expirată) | coada rămâne intactă; după login, sincronizarea continuă | **M3 ✔** |
| T-SYNC-07 | două sincronizări simultane | o singură rulare | **M3 ✔** |
| T-SYNC-08 | două dispozitive editează offline; se sincronizează pe rând | pe server, modificarea cea mai recentă; celălalt dispozitiv o preia, cu mesaj | **M3 ✔** |
| T-SYNC-09 | offline: creare + editare, „restart” (motor nou, aceeași stocare), revenire online | ambele pe server | **M3 ✔** |
| T-SYNC-10 | o modificare făcută chiar în timpul trimiterii | ajunge pe server într-o rundă suplimentară, cu un singur apel de sincronizare | **M3 ✔** |
| T-SYNC-11 | alt utilizator pe același dispozitiv; logout | refuzat cât există modificări nesincronizate; apoi datele celui anterior nu rămân vizibile; logout golește stocarea | **M3 ✔** |
| T-SYNC-12 | conflict în ordinea inversă: varianta veche ajunge prima, cea nouă o înlocuiește | dispozitivul cu varianta veche primește mesaj la următoarea sincronizare | **M3 ✔** |
| T-SYNC-13 | ceasul dispozitivului cu 10 minute înainte | marcajele de timp sunt corectate față de server; modificarea ajunge pe server | **M3 ✔** |
| T-SYNC-14 | ceasul cu 2,2 s în urmă (lângă prag), 20 de editări consecutive | niciuna nu se pierde, niciun conflict fals (eșuează pe varianta fără histerezis) | **M3 ✔** |
| T-SYNC-15 | editare făcută imediat după ce ai văzut varianta altui dispozitiv, cu ceasul 1,5 s în urmă | editarea o înlocuiește, fără conflict | **M3 ✔** |
| T-SYNC-16 | draft respins de server (400), apoi login cu alt cont | refuzat: draft-ul e numărat ca nesalvat | **M3 ✔** |
| T-SYNC-17 | răspunsuri cu corpul descărcat lent (3 s) | ceasul nu e „corectat” greșit; marcajele rămân la ora reală | **M3 ✔** |
| T-SYNC-18 | refuz (400) pentru o variantă corectată local cât cererea era pe drum | varianta corectă pleacă totuși; nicio eroare rămasă | **M3 ✔** |
| T-SYNC-19 | scrierea în stocare eșuează (spațiu plin) | modificarea nu apare ca salvată; următoarea salvare reușește | **M3 ✔** |
| T-SYNC-20 | prima încercare a unei cereri expiră (timeout), a doua reușește; ceasul e corect | ceasul nu e „corectat”: timpul încercării eșuate nu e socotit | **M3 ✔** |
| T-SYNC-21 | rețea lentă (antete după 1,2 s) și ceasul cu 10 minute înainte | ceasul e totuși corectat; marcajele rămân la ora reală | **M3 ✔** |
| — | răspunsuri lente (3 s), ceas corect | nicio corecție falsă | **M3 ✔** |
| — | sincronizări repetate | șabloanele nu se mai cer de fiecare dată | **M3 ✔** |
| — | 5xx se reîncearcă, 4xx nu; corp care nu e JSON; două salvări în aceeași milisecundă | ✔ | **M3 ✔** |

**Browser (Playwright, build de producție):**

| ID | Scenariu | Rezultat așteptat | Etapa |
|---|---|---|---|
| T-OFF-01 | login → mod avion → completare inspecție asignată + creare inspecție nouă → reîncărcare | aplicația se încarcă offline; ambele draft-uri sunt prezente | **M3 ✔** |
| T-OFF-02 | ca T-OFF-01, dar browserul se închide și se redeschide (același profil) | draft-urile sunt prezente | **M3 ✔** |
| T-OFF-03 | după T-OFF-01: revenire online, fără nicio acțiune | ambele inspecții ajung pe server; coada e goală | **M3 ✔** |
| T-OFF-04 | primul `PUT` ajunge la server, dar răspunsul e pierdut | clientul reîncearcă; 1 rând în BD; coada e goală | **M3 ✔** |
| T-OFF-05 | două dispozitive editează aceeași inspecție offline; se sincronizează pe rând | pe server rămâne modificarea cea mai recentă; celălalt dispozitiv o afișează, cu mesaj | **M3 ✔** |
| T-OFF-06 | dispozitivul A trimite spre revizie; B (offline, cu date vechi) editează și sincronizează | B primește 409, preia starea serverului, afișează conflictul; serverul e neschimbat | **M3 ✔** |
| T-OFF-05b | ca T-OFF-05, dar în ordinea inversă: varianta veche se sincronizează prima | varianta nouă rămâne pe server; dispozitivul vechi, lăsat deschis online **fără niciun click**, afișează în cel mult 45 s mesajul „modificată ulterior de pe alt dispozitiv” | **M3 ✔** |
| T-OFF-07 | T-OFF-01 + T-OFF-03 cu 10 minute fără rețea (`npm run test:off-10min`) | ca mai sus; dovada: [`evidence/off-10min.md`](evidence/off-10min.md) | **M3 ✔** |
| T-OFF-09 | browserul e online, dar `PUT`-urile depășesc timeout-ul de 5 s | 3 încercări, eroare afișată, modificarea rămâne în coadă; după revenire, trimisă automat de reîncercarea periodică | **M3 ✔** |
| T-OFF-10 | inspecție trimisă spre revizie offline, apoi redeschisă | blocată (fără buton de trimitere, răspunsuri dezactivate) până ajunge pe server ca `submitted` | **M3 ✔** |
| T-OFF-11 | al doilea tab în același browser | afișează un mesaj; devine activ când primul se închide | **M3 ✔** |
| T-OFF-08 | offline cu 2 modificări | antetul arată „Offline” și „2 nesincronizate” | **M3 ✔** |

### End-to-end

| ID | Scenariu | Rezultat așteptat | Etapa |
|---|---|---|---|
| T-E2E-01 | coordonatorul asignează → inspectorul completează și trimite → coordonatorul aprobă → apare chitanța Registrului | fluxul complet în browser | **M3 ✔** |
| T-E2E-02 | interfața la 390 px și la 1280 px lățime | fără derulare orizontală; butoane utilizabile | **M3 ✔** |

### Încărcare

| ID | Test | Etapa |
|---|---|---|
| T-LOAD-01 | 3 niveluri de încărcare (`npm run load`), rezultate în [`evidence/load-results.md`](evidence/load-results.md) | **M3 ✔** |
| T-LOAD-02 | același test fără indexuri (`npm run load:fara-indexuri`), rezultate în [`evidence/load-results-fara-indexuri.md`](evidence/load-results-fara-indexuri.md) | **M3 ✔** |

---

## 4. Demonstrație manuală: 10 minute offline

1. `npm run build && npm start`, apoi deschideți aplicația în Chrome și autentificați-vă ca
   inspector.
2. DevTools → Network → **Offline** (sau mod avion pe telefon). Notați ora.
3. Completați o inspecție asignată și creați una nouă, cu o poză.
4. Reîncărcați pagina (F5) cel puțin o dată. Verificați că datele sunt acolo.
5. După minimum 10 minute, reveniți **Online**. Notați ora.
6. Verificați că indicatorul ajunge la „0 nesincronizate” și, autentificați ca coordonator, că
   ambele inspecții apar pe server.

Pașii completi ai prezentării: [`demo.md`](demo.md). Rularea automată de 10 minute:
`npm run test:off-10min`, cu dovada în [`evidence/off-10min.md`](evidence/off-10min.md).

---

## 5. Lacune și riscuri

Analiza completă, cu codul neacoperit și funcționalitățile insuficient testate:
[`evidence/coverage-M3.md`](evidence/coverage-M3.md#funcționalități-insuficient-testate-și-riscuri).
Pe scurt:

| Zonă | Risc | Tratament |
|---|---|---|
| Componentele React | testate doar prin Playwright, nu prin teste de componentă | acceptat: logica de business e pe server și în modulul de sincronizare, testate separat |
| Actualizarea service worker-ului între versiuni | un utilizator offline poate rula o versiune veche a aplicației | documentat ca limită |
| Mai multe tab-uri pe același dispozitiv | ar putea suprascrie draft-urile unul altuia | un singur tab activ (Web Locks API, T-OFF-11); rămâne doar în browserele fără Web Locks |
| Ceasul dispozitivului | regula de conflict depinde de el | corecție față de ora serverului (R8, T-SYNC-13) + respingerea marcajelor din viitor pe server (T-VAL-08); un dispozitiv care n-a fost niciodată online cu ceasul greșit rămâne expus |
| Spațiul IndexedDB | browserul îl poate elibera | `navigator.storage.persist()`; documentat ca limită |
| Concurența SQLite | o singură scriere la un moment dat | măsurat în testul de încărcare: nu e o problemă la sarcina țintă |
