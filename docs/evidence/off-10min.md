# Dovadă: 10 minute offline (T-OFF-07)

Generat automat de `npm run test:off-10min` (scripts/off-10min.js). Fiecare rulare rescrie acest fișier.

| | |
|---|---|
| Rezultat | ✅ trecut |
| Start | 2026-11-11T21:55:26.286Z |
| Final | 2026-11-11T22:05:40.215Z (10.2 minute) |
| Durata offline cerută | 600 s |
| Calculator | Linux 6.18.44-fc-v378, 2 nuclee, Node.js v22.23.4 |

**Scenariul** (e2e/off.spec.js, T-OFF-01/03/08): login → mod avion → editarea unei inspecții asignate
și crearea uneia noi → **reîncărcarea paginii fără rețea** → 10 minute fără rețea → revenire
online → verificare, prin API, că ambele inspecții au ajuns pe server fără nicio acțiune manuală.

## Ieșirea testului

```
Running 1 test using 1 worker

  ✓  1 [telefon] › e2e/off.spec.js:11:1 › T-OFF-01/03/08 mod avion → editare + creare → reîncărcare → revenire online → sincronizare automată (10.1m)

  Slow test file: [telefon] › e2e/off.spec.js (10.1m)
  Consider running tests from slow files in parallel. See: https://playwright.dev/docs/test-parallel
  1 passed (10.2m)
```
