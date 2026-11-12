# Pachetul EXT — Integrare externă rezilientă

## Cerința

**Din catalogul de pachete:** serviciu extern sau simulator cu **timeout, eroare, rate limit și
răspuns duplicat**. Verificare obligatorie: **teste deterministe de eroare, retry limitat, stări
coerente și efecte idempotente**.

**Din fișa temei:** simulator de rețea cu timeout și răspunsuri duplicate.

## Integrarea aleasă: Registrul PSI

Fiecare inspecție **aprobată** de coordonator e transmisă de server unui registru extern, care
întoarce un număr de înregistrare (chitanță). Pentru cost zero și rezultate reproductibile,
registrul e un **simulator local** (`registry-sim/`): o aplicație Express separată, pornită pe
portul 4000, care respectă contractul de mai jos și poate produce la comandă fiecare tip de
eșec.

Aceeași integrare acoperă și cerința de bază nr. 7 din specificația generală (integrare cu un
serviciu extern sau un substitut cu contract clar).

## Contractul de integrare

### `POST /v1/reports`: înregistrarea unei inspecții

**Antete:**

| Antet | Valoare |
|---|---|
| `Authorization` | `Bearer <REGISTRY_API_KEY>` |
| `Idempotency-Key` | ID-ul inspecției (UUID) |
| `Content-Type` | `application/json` |

**Corp:**

```json
{
  "inspectionId": "8f3c2a1e-6d4b-4c1a-9e2f-1b7a0c9d5e44",
  "location": "Bloc A, parcare -2",
  "templateName": "Stingătoare și hidranți",
  "inspectorName": "Ion Popescu",
  "approvedAt": "2026-11-20T10:02:11.000Z",
  "summary": { "pass": 5, "fail": 1, "na": 0 },
  "nonConformities": [
    { "question": "Stingătorul e în termen de valabilitate?", "note": "Expirat din 03/2026" }
  ]
}
```

**Răspunsuri:**

| Status | Corp | Semnificație | Ce face FireCheck |
|---|---|---|---|
| `201` | `{ "receiptNo": "PSI-2026-000123", "registeredAt": "…", "duplicate": false }` | înregistrată acum | salvează chitanța → `sent` |
| `200` | același corp, `"duplicate": true` | cheia a mai fost înregistrată; aceeași chitanță | tratează ca succes → `sent` |
| `400` | `{ "error": "…" }` | date invalide | fără reîncercare → `failed` |
| `401` | `{ "error": "…" }` | cheie de acces greșită | fără reîncercare → `failed` |
| `429` | antet `Retry-After` (secunde sau dată HTTP), opțional | limitare de trafic | așteaptă `Retry-After` (plafonat la 10 minute), apoi reîncearcă; fără antet, folosește backoff-ul normal |
| `500`, `503` | — | eroare temporară | reîncearcă cu backoff |
| fără răspuns în 3 s | — | timeout | anulează cererea (`AbortController`), reîncearcă cu backoff |

**Garanția de idempotență a Registrului:** pentru același `Idempotency-Key`, Registrul creează o
singură înregistrare și întoarce mereu aceeași chitanță.

### Rute de control (doar în simulator, pentru teste)

| Rută | Rol |
|---|---|
| `POST /_control/scenario` `{ "steps": ["timeout", "rate_limit", "ok"] }` | următoarele cereri primesc, în ordine, aceste comportamente; după listă, `ok` |
| `GET /_control/stats` | numărul de cereri primite și de înregistrări create, pe fiecare cheie |
| `POST /_control/reset` | golește înregistrările și scenariul |

**Pașii posibili într-un scenariu:**

| Pas | Ce face simulatorul |
|---|---|
| `ok` | înregistrează și răspunde 201 (sau 200 `duplicate` dacă cheia există deja) |
| `timeout` | nu răspunde 10 s, apoi înregistrează. Clientul a renunțat deja, deci reîncercarea primește un răspuns duplicat. |
| `lost_response` | înregistrează, apoi închide conexiunea fără răspuns (răspuns pierdut) |
| `error_500`, `error_503` | răspunde cu eroarea, fără să înregistreze |
| `rate_limit` | răspunde 429 cu `Retry-After: 1` (configurabil) |
| `rate_limit_no_header` | răspunde 429 fără `Retry-After` |
| `bad_request` | răspunde 400 |

Scenariile fac testele **deterministe**: fără întâmplare și fără dependență de viteza rețelei.

## Soluția pe scurt

- **Starea operației e persistentă:** tabela `registry_submissions` (`pending` → `sending` →
  `sent` / `failed`), cu numărul de încercări, ultima eroare, momentul următoarei încercări și
  chitanța.
- **Aprobarea și crearea trimiterii sunt atomice** (aceeași tranzacție, R11). Aprobarea nu
  depinde de Registru: dacă Registrul e indisponibil, inspecția rămâne aprobată, iar trimiterea
  rămâne în așteptare sau eșuată, vizibil pentru coordonator.
- **Reîncercări limitate:** maximum 5 încercări, timeout 3 s, backoff 1 s → 2 s → 4 s → 8 s,
  `Retry-After` respectat la 429 (plafonat la 10 minute). Fără reîncercare la 400 sau 401 (R12).
- **Fără blocaje:** o excepție neprevăzută în timpul trimiterii o trece în `failed`, cu mesajul
  erorii, în loc să o lase în `sending`.
- **Efecte idempotente:** `Idempotency-Key` = ID-ul inspecției; `UNIQUE (inspection_id)` în baza
  de date; chitanța se scrie o singură dată (R10).
- **Reluare după restart:** la pornire, serverul reia trimiterile rămase `pending` sau `sending`.
- **Reîncercare manuală:** coordonatorul poate repune în coadă o trimitere `failed`.

Detalii: [`architecture.md`](../architecture.md#7-integrarea-cu-registrul-psi-server).
Decizia și alternativele: [ADR-002](../adr/ADR-002-registru-extern-rezilient.md).

## Verificări obligatorii → teste

| Verificare cerută | Teste |
|---|---|
| Teste deterministe de eroare: timeout | T-EXT-02 |
| … eroare | T-EXT-04, T-EXT-06, T-EXT-07, T-EXT-12 |
| … rate limit | T-EXT-05 (cu `Retry-After`), T-EXT-15 (fără antet) |
| … răspuns duplicat | T-EXT-03, T-EXT-09 |
| Retry limitat | T-EXT-06 (se oprește după exact 5 cereri), T-EXT-07 (o singură cerere la 400) |
| Stări coerente | T-EXT-06, T-EXT-08, T-EXT-10, T-EXT-12, T-EXT-14 (excepție neprevăzută → `failed`) |
| Efecte idempotente | T-EXT-02, T-EXT-03, T-EXT-09, T-EXT-11 (o singură înregistrare în simulator și o singură chitanță) |

Lista completă: [`testing.md`](../testing.md#pachetul-ext).

## Dovezi

| Dovadă | Unde | Comandă |
|---|---|---|
| Ieșirea testelor T-EXT, cu numărul de cereri și înregistrări din simulator | [`evidence/ext-M2.md`](../evidence/ext-M2.md#1-testele-ext) | `node --test --test-reporter=spec tests/ext/registry.test.js` |
| Cronologia unei trimiteri cu timeout + 429 (`Retry-After` 3 s) + 503 + răspuns pierdut + ok | [`evidence/ext-M2.md`](../evidence/ext-M2.md#2-cronologia-unei-trimiteri-cu-toate-tipurile-de-eșec) | `npm run demo:ext` |

**Pornire manuală:** `npm run registry` pornește simulatorul pe portul 4000 (inclus automat în
`npm run dev`). Scenariile se pot seta și de mână, de exemplu:

```bash
curl -X POST http://localhost:4000/_control/scenario -H "Content-Type: application/json" -d "{\"steps\":[\"rate_limit\",\"ok\"]}"
```

## Limite cunoscute

- Procesorul rulează în procesul serverului. Pentru mai multe instanțe de server ar fi nevoie de
  blocarea rândului sau de o coadă externă. Nu e cazul aici: o singură instanță.
- Dacă Registrul real nu ar garanta idempotența după `Idempotency-Key`, un răspuns pierdut ar
  putea crea o a doua înregistrare acolo. Partea FireCheck ar rămâne totuși corectă (o singură
  chitanță salvată).
- Simulatorul reproduce contractul, nu și performanța unui serviciu real.
- Interpretarea pachetului: „serviciul extern” e Registrul PSI (server → Registru). Legătura
  browser → server, cu timeout, reîncercări și retransmisii, e acoperită de pachetul OFF
  (T-OFF-04, T-OFF-09, T-SYNC-01…03).
