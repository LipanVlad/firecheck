# Demonstrație — FireCheck

Pașii pentru prezentarea finală (M3). Durată estimată: 15 minute, plus 10 minute pentru
demonstrația offline completă (pasul 4, care poate rula în paralel cu pașii 5–6).

## 0. Pregătire (înainte de prezentare)

```bash
npm ci
cp .env.example .env            # Windows: copy .env.example .env
npx playwright install chromium # o singură dată, pentru testele în browser
npm run seed
npm run build
```

Deschideți trei terminale în folderul proiectului:

| Terminal | Comandă | Rol |
|---|---|---|
| 1 | `npm run registry` | simulatorul Registrului PSI (port 4000) |
| 2 | `npm start` | aplicația în mod producție (http://localhost:3000) |
| 3 | liber | pentru teste și demonstrații |

În Chrome: o fereastră normală pentru **coordonator** și una **incognito** pentru **inspector**
(sesiuni separate). Pentru inspector, deschideți DevTools (F12) → bara de instrumente pentru
dispozitive (Ctrl+Shift+M), ca aplicația să arate ca pe telefon.

Conturi: `coord` / `coord123`, `inspector1` / `insp123`.

## 1. Fluxul principal (F1 + F3), ~4 minute

1. **Coordonator** → *Asignare*: șablon „Stingătoare și hidranți”, inspector Andrei Popescu,
   locație „Demo, parcare -2”, un termen → *Asignează*.
2. **Inspector** (`inspector1`) → inspecția „Demo, parcare -2” apare în *De făcut*.
3. Apasă *Trimite spre revizie* fără răspunsuri: aplicația arată întrebările lipsă (validare).
4. Răspunde la toate întrebările (una *Neconform*, cu o observație), adaugă o poză → *Trimite
   spre revizie*.
5. **Coordonator** → *Inspecții* → caută „Demo” → deschide → *Aprobă și trimite la Registru*.
   În câteva secunde apare **chitanța** `PSI-2026-…`.
6. *Raport*: inspecția apare la „Aprobată”, iar neconformitatea în top.

**Ce subliniem:** rolurile (inspectorul nu are meniurile coordonatorului; serverul răspunde 403
dacă le cere oricum), cele 5 stări, validarea pe server.

## 2. Pachetul OFF, varianta scurtă (~3 minute)

1. **Inspector**: DevTools → *Network* → **Offline**. Antetul arată „Offline”.
2. Deschide o inspecție *În lucru*, schimbă un răspuns. Apoi *+ Inspecție nouă*, cu o locație și
   un răspuns. Antetul arată „2 nesincronizate”.
3. **Reîncarcă pagina (F5)** cu rețeaua oprită: aplicația se deschide (din cache-ul service
   worker-ului), iar modificările sunt acolo.
4. Repune **No throttling** (online): fără niciun click, contorul ajunge la „0 nesincronizate”.
5. **Coordonator**: cele două modificări sunt pe server.

**Ce subliniem:** IndexedDB + service worker; ID-ul generat pe telefon + `PUT` idempotent
(fără duplicate); sincronizarea automată la evenimentul `online`.

## 3. Pachetul EXT (~2 minute)

În terminalul 3:

```bash
npm run demo:ext
```

Se vede, pe rând: timeout → 429 → 503 → răspuns pierdut → succes la a 5-a încercare, cu pauzele
0,5 s → **3 s** → 2 s → 4 s. Pauza de 3 s după 429 e cea cerută de Registru prin `Retry-After`
(backoff-ul ar fi fost 1 s). La final: **5 cereri, 1 înregistrare, 1 chitanță**.

Opțional, în aplicație: setați un scenariu și aprobați o inspecție.

```bash
curl -X POST http://localhost:4000/_control/scenario -H "Content-Type: application/json" -d "{\"steps\":[\"error_503\",\"error_503\",\"error_503\",\"error_503\",\"error_503\"]}"
```

Inspecția aprobată arată starea „Eșuată” după 5 încercări (~15 s). Butonul *Retrimite* o duce la
„Înregistrată”.

## 4. OFF complet: 10 minute offline (cerința din fișa temei)

**Automat** (rulează singur ~11 minute, se poate porni la începutul prezentării):

```bash
npm run test:off-10min
```

La final, dovada (orele de start și final și ieșirea testului) e în
[`evidence/off-10min.md`](evidence/off-10min.md).

**Manual:** ca la pasul 2, dar rețeaua rămâne oprită minimum 10 minute, cu cel puțin o
reîncărcare. Notați ora de start și ora de revenire.

## 5. Dovezile automate (~3 minute)

```bash
npm test             # 197 de teste: unitate, integrare, securitate, EXT, sincronizare
npm run coverage     # pragurile 70% / 60% sunt verificate automat
npm run test:e2e     # Playwright: fluxul complet + toate scenariile OFF (11 teste)
```

Raportul Playwright: `npx playwright show-report`.

## 6. Capacitate (~2 minute)

`npm run load` durează ~4 minute (3 niveluri × 60 s) și scrie
[`evidence/load-results.md`](evidence/load-results.md). La prezentare se arată fișierul generat
dinainte: throughput, p50/p95, erori, CPU și memorie pe fiecare nivel, estimarea capacității și
blocajul. Comparația cu varianta fără indexuri: [`evidence/load-results-fara-indexuri.md`](evidence/load-results-fara-indexuri.md)
(`npm run load:fara-indexuri`).

## Unde e fiecare lucru

| Subiect | Document |
|---|---|
| Cerințe, stări, reguli | [requirements.md](requirements.md) |
| Arhitectură, API, securitate | [architecture.md](architecture.md) |
| Pachetul OFF | [packages/OFF.md](packages/OFF.md), [ADR-001](adr/ADR-001-offline-indexeddb-sincronizare.md) |
| Pachetul EXT | [packages/EXT.md](packages/EXT.md), [ADR-002](adr/ADR-002-registru-extern-rezilient.md) |
| Teste și coverage | [testing.md](testing.md), [evidence/](evidence/) |
| Capacitate | [capacity.md](capacity.md), [evidence/load-results.md](evidence/load-results.md) |
| Utilizarea AI | [ai-usage.md](ai-usage.md) |
