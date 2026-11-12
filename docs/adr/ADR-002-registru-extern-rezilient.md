# ADR-002 — Integrare rezilientă cu Registrul PSI: stare persistentă, reîncercări limitate și idempotență

**Status:** Implementat și verificat (M2).
**Pachet:** EXT

## Problemă

Fiecare inspecție aprobată trebuie transmisă unui serviciu extern, care poate fi lent, poate da
erori temporare, poate limita traficul (429) sau poate răspunde duplicat. Aplicația trebuie să
reîncerce controlat, să nu creeze înregistrări sau chitanțe duplicate și să arate în orice moment
o stare coerentă a operației.

## Alternative

### 1. Când se face apelul extern

| Variantă | Pro | Contra |
|---|---|---|
| **Asincron: aprobarea creează o trimitere `pending` (aceeași tranzacție), iar un procesor din server o trimite** | aprobarea e rapidă și nu depinde de Registru; starea e persistentă și se reia după restart | starea operației trebuie afișată separat |
| sincron, în cererea de aprobare | cel mai simplu | cererea poate dura zeci de secunde cu reîncercări; un restart în timpul apelului pierde operația; aprobarea ar eșua când Registrul e jos |
| coadă externă (Redis, RabbitMQ) | scalează pe mai multe instanțe | infrastructură în plus, nejustificată pentru o singură instanță |

### 2. Cum se evită efectele duplicate

| Variantă | Pro | Contra |
|---|---|---|
| **`Idempotency-Key` = ID-ul inspecției + `UNIQUE (inspection_id)` + chitanță scrisă o singură dată** | protecție pe ambele părți; cheia e stabilă la reîncercări și după restart | depinde de respectarea contractului de către Registru |
| doar verificare locală („am trimis deja?”) | nimic de cerut Registrului | un răspuns pierdut după înregistrare ar duce la o a doua înregistrare la reîncercare |

### 3. Politica de reîncercare

| Variantă | Pro | Contra |
|---|---|---|
| **5 încercări, timeout 3 s, backoff exponențial 1 → 2 → 4 → 8 s, `Retry-After` la 429 (plafon 10 minute), fără reîncercare la 400/401** | limitează sarcina pe Registru; respectă semnalul de limitare de trafic; erorile permanente se opresc imediat | după 5 eșecuri e nevoie de reîncercare manuală |
| reîncercări nelimitate | nu renunță niciodată | poate suprasolicita Registrul; operația nu ajunge niciodată într-o stare finală |
| fără reîncercări | simplu | o eroare temporară lasă inspecția netransmisă |

### 4. Simulatorul

| Variantă | Pro | Contra |
|---|---|---|
| **Aplicație Express separată, cu scenarii de pași (`["timeout", "rate_limit", "ok"]`)** | proces și port separate, ca un serviciu real; teste deterministe; zero cost | trebuie întreținut împreună cu contractul |
| erori injectate aleatoriu | arată „realist” | teste nedeterministe |
| un serviciu public real | autentic | cost, conturi, rezultate nereproductibile |

## Decizie

Trimitere asincronă cu stare persistentă în `registry_submissions`, procesor în procesul
serverului, `Idempotency-Key` stabil, `UNIQUE (inspection_id)`, 5 încercări cu backoff exponențial
și `Retry-After` (plafonat la 10 minute), reluare la pornire, trecere în `failed` la orice
excepție neprevăzută și reîncercare manuală pentru `failed`. Registrul e un
simulator local cu scenarii deterministe.

## Experiment / test

Testele T-EXT-01…15 din [`testing.md`](../testing.md#pachetul-ext). Pentru fiecare se verifică:
starea finală a trimiterii, numărul de încercări, chitanța și, din `GET /_control/stats`,
numărul de cereri primite și de înregistrări create de simulator.

**Rezultate:** toate cele 18 teste din `tests/ext/registry.test.js` trec. În demonstrația
`npm run demo:ext`, o trimitere care întâlnește pe rând timeout, 429, 503 și un răspuns pierdut
reușește la a 5-a încercare, cu pauzele 0,5 s (backoff) → 3 s (`Retry-After`, în loc de 1 s cât ar fi
fost backoff-ul) → 2 s → 4 s, iar Registrul are **o singură
înregistrare** pentru cele 5 cereri. Detalii: [`evidence/ext-M2.md`](../evidence/ext-M2.md).

## Limite

- Procesorul în proces presupune o singură instanță de server.
- Corectitudinea pe partea Registrului depinde de respectarea `Idempotency-Key`.
- Simulatorul reproduce contractul, nu și latențele reale ale unui serviciu public.
- Scrierile în SQLite sunt serializate în proces (`db.write()`), deci revendicarea unei trimiteri
  (`pending` → `sending`) e sigură doar într-o singură instanță de server.
