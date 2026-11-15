# Pachetul OFF — Funcționare offline și sincronizare

## Cerința

**Din catalogul de pachete:** acțiuni selectate funcționează fără rețea și se sincronizează
ulterior. Verificare obligatorie: **mod avion, reîncărcare pagină, revenire online, retransmisii
duplicate, conflict**.

**Din fișa temei:** creare/editare offline și sincronizare după restart; minimum 10 minute offline,
cu reîncărcare de pagină înainte de revenirea online.

## Ce acțiuni funcționează offline

| Acțiune | Offline |
|---|:---:|
| Deschiderea aplicației (deja autentificat) și reîncărcarea paginii | ✅ |
| Vizualizarea inspecțiilor proprii și a șabloanelor | ✅ (ultima copie descărcată) |
| Completarea unei inspecții asignate (răspunsuri, observații, poze) | ✅ |
| Crearea unei inspecții neplanificate | ✅ |
| Trimiterea spre revizie | ✅ (blocată imediat pe dispozitiv; ajunge pe server la reconectare) |
| Login inițial, operațiile coordonatorului, raportul | ❌ cer rețea |

## Soluția pe scurt

- **Service worker** (`vite-plugin-pwa`): păstrează în cache fișierele aplicației, deci
  reîncărcarea offline funcționează.
- **IndexedDB** (`idb-keyval`): sesiunea, șabloanele, inspecțiile, draft-urile și coada de
  sincronizare. Rezistă la reîncărcare și la restartul browserului.
- **ID generat de client** (`crypto.randomUUID()`) + **`PUT` idempotent**: aceeași inspecție
  trimisă de oricâte ori produce un singur rând (R1).
- **Conflicte:** ultima modificare câștigă, după `clientUpdatedAt` (R2), cu ceasul corectat față
  de server (R8). Inspecțiile aflate în revizie sau aprobate sunt blocate pentru inspector (R3, 409).
  Propriile editări sunt mereu mai noi decât varianta pe care se bazează, deci nu se pierd din cauza
  ceasului. Dispozitivul a cărui modificare e înlocuită primește un mesaj, oricare ar fi ordinea
  sincronizărilor: imediat, dacă sincronizează al doilea; altfel la următoarea sincronizare (cel
  mult 30 s cât e deschis online).
- **Sincronizare automată** la pornire, la evenimentul `online`, după fiecare salvare făcută
  online, la revenirea în aplicație și la 30 s cât e deschisă și online (semnal slab, modificări
  de pe alte dispozitive), plus buton manual. O modificare
  făcută în timpul unei sincronizări pleacă într-o rundă suplimentară. Timeout și reîncercări
  limitate (R12).

Detalii: [`architecture.md`](../architecture.md#6-sincronizarea-offline-client).
Decizia și alternativele: [ADR-001](../adr/ADR-001-offline-indexeddb-sincronizare.md).

## Verificări obligatorii → teste

| Verificare cerută | Test | Cum se simulează |
|---|---|---|
| Mod avion | T-OFF-01 | Playwright `context.setOffline(true)` |
| Reîncărcare pagină | T-OFF-01 | `page.reload()` cu rețeaua oprită |
| Restart (fișa temei) | T-OFF-02 | se închide și se redeschide browserul cu același profil (context persistent) |
| Revenire online | T-OFF-03 | `context.setOffline(false)`, fără acțiune manuală |
| Retransmisii duplicate | T-OFF-04 (E2E), T-IDEM-01/02 (API), T-SYNC-03 (unitate) | prima cerere ajunge la server, dar răspunsul e „pierdut” (`route.fetch()` urmat de `route.abort()`), deci clientul reîncearcă |
| Conflict | T-OFF-05, T-OFF-05b, T-OFF-06, T-OFF-10 (E2E), T-SYNC-08, T-SYNC-12, T-SYNC-14, T-SYNC-15 (client), T-CONF-01…05 (API) | două dispozitive (două contexte de browser) ale aceluiași inspector editează aceeași inspecție offline și se sincronizează în **ambele ordini**; plus conflictul cu o inspecție deja trimisă |
| Semnal slab (online, dar serverul nu răspunde) | T-OFF-09 (E2E), T-SYNC-02, T-SYNC-17 (descărcare lentă), T-SYNC-20 (reîncercare după timeout), T-SYNC-21 (rețea lentă) | cererile `PUT` depășesc timeout-ul de 5 s; după revenire, trimiterea pleacă singură |
| 10 minute offline (fișa temei) | T-OFF-07 | `npm run test:off-10min`: T-OFF-01 cu 10 minute fără rețea; dovada se scrie automat în `evidence/off-10min.md` |

Lista completă a testelor: [`testing.md`](../testing.md#pachetul-off).

## Dovezi

| Dovadă | Unde | Comandă |
|---|---|---|
| Testele Playwright: fluxul complet și scenariile OFF (11/11) | [`evidence/off-M3.md`](../evidence/off-M3.md#1-testele-în-browser-playwright-build-de-producție) | `npm run test:e2e` |
| Rularea cu 10 minute offline și reîncărcare (T-OFF-07), cu ieșirea completă a testului | [`evidence/off-10min.md`](../evidence/off-10min.md) | `npm run test:off-10min` |
| Testele modulului de sincronizare T-SYNC-01…21 | [`evidence/off-M3.md`](../evidence/off-M3.md#2-modulul-de-sincronizare-node-contra-serverului-real) | `node --test tests/client/sync.test.js` |
| Testele API pentru duplicate și conflicte (T-IDEM, T-CONF) | [`evidence/coverage-M3.md`](../evidence/coverage-M3.md) | `npm test` |
| Capturi de ecran: offline, coadă, conflict | [`evidence/off-M3.md`](../evidence/off-M3.md#3-capturi-de-ecran) | — |

**Unde e codul:** `client/src/lib/sync.js` (motorul de sincronizare), `client/src/lib/http.js`
(timeout și reîncercări), `client/src/lib/engine.js` (IndexedDB și legătura cu React),
`vite.config.js` (service worker-ul), `server/services/inspections.js` (`PUT` idempotent și
regula de conflict pe server).

## Limite cunoscute

- Regula „ultima modificare câștigă” depinde de ceasul dispozitivului. Corecția față de server
  (R8) funcționează după cel puțin o conexiune la server; un dispozitiv care nu a fost niciodată
  online cu ceasul greșit rămâne expus (serverul respinge doar marcajele cu peste 5 minute în viitor).
  Corecția are precizia antetului `Date` (o secundă) plus pragul de 2 s (mai mult pe o rețea lentă:
  plus jumătate din drumul dus-întors), deci între două
  dispozitive care editează **în paralel** aceeași inspecție, la câteva secunde distanță, câștigătoarea
  poate fi oricare. Editările succesive (una după ce a văzut-o pe cealaltă) nu sunt afectate.
- Când două dispozitive modifică aceeași inspecție, modificarea mai veche se pierde (nu se
  îmbină pe câmpuri). Dispozitivul afectat afișează însă un mesaj, în ambele ordini de sincronizare;
  în ordinea inversă, mesajul apare cu o întârziere de cel mult 30 s (sincronizarea periodică).
- Login-ul inițial cere rețea. Dacă tokenul expiră (7 zile) cât inspectorul e offline, datele
  rămân în coadă până la o nouă autentificare cu același cont.
- Sincronizarea are loc doar cât aplicația e deschisă (Background Sync nu e suportat în Firefox și
  Safari).
- Spațiul IndexedDB poate fi eliberat de browser când discul e aproape plin. Aplicația cere
  `navigator.storage.persist()`, dar browserul poate refuza.
- Un singur tab al aplicației e activ pe dispozitiv (Web Locks API, T-OFF-11). În browserele foarte
  vechi, fără Web Locks, două tab-uri și-ar putea suprascrie draft-urile.
- Delogarea șterge datele locale, inclusiv modificările nesincronizate (aplicația cere
  confirmare dacă există). Autentificarea cu alt cont e refuzată cât există modificări în coadă.
