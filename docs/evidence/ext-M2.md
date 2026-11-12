# Dovezi — pachetul EXT

Rezultate reproductibile: se obțin din nou cu comenzile de mai jos, pe orice calculator.
(Fișierul a apărut la M2; conținutul e regenerat pe codul final.)

| | |
|---|---|
| Sistem | Linux (mediu de dezvoltare), 2 nuclee, 8 GB RAM |
| Node.js | 22.23 |
| Data | 11.11.2026 |

## 1. Testele EXT

Comandă: `node --test --test-reporter=spec tests/ext/registry.test.js`

Fiecare test setează un scenariu fix în simulator și verifică trei lucruri: starea finală a
trimiterii, numărul de încercări și, din `GET /_control/stats`, câte cereri și câte înregistrări a
primit Registrul.

```
✔ T-FLOW-01 flux complet: asignare → completare → trimitere → aprobare → chitanță → raport
▶ scenarii de eroare deterministe
  ✔ T-EXT-01 ok → sent, chitanță, 1 încercare; raportul trimis conține neconformitatea
  ✔ T-EXT-02 timeout, ok → sent după 2 încercări; o singură înregistrare
  ✔ T-EXT-03 lost_response, ok → a doua încercare primește răspuns duplicat; aceeași chitanță
  ✔ T-EXT-04 error_503, error_500, ok → sent după 3 încercări, cu backoff 1 s, 2 s
  ✔ T-EXT-15 429 fără Retry-After → backoff exponențial normal, nu reîncercări imediate
  ✔ T-EXT-05 rate_limit, ok → așteaptă Retry-After (1 s), apoi sent
✔ scenarii de eroare deterministe
▶ reîncercări limitate și stări coerente
  ✔ T-EXT-06 error_503 × 5 → failed după exact 5 cereri, cu ultima eroare salvată
  ✔ T-EXT-08 reîncercare manuală după failed → pending → sent
  ✔ reîncercarea manuală e permisă doar pentru failed → 409; inspecție inexistentă → 404
  ✔ T-EXT-07 bad_request → failed după exact 1 cerere (4xx nu se reîncearcă)
✔ reîncercări limitate și stări coerente
▶ efecte idempotente
  ✔ T-EXT-09 aceeași trimitere pornită de mai multe ori în paralel → 1 cerere, 1 chitanță
  ✔ T-EXT-11 dublu click pe „Aprobă” → a doua cerere 409, o singură trimitere
  ✔ T-EXT-10 restart: trimiterile rămase pending/sending sunt reluate de un server nou
✔ efecte idempotente
▶ erori neprevăzute
  ✔ după un restart, trimiterea rămâne pending cât așteaptă pauza programată
  ✔ T-EXT-14 o excepție neașteptată în timpul trimiterii → failed (nu rămâne blocată în sending)
✔ erori neprevăzute
▶ Registru indisponibil sau configurat greșit
  ✔ T-EXT-12 conexiune refuzată → failed după 5 încercări; inspecția rămâne approved
  ✔ cheie de acces greșită → 401 de la Registru → failed fără reîncercări
✔ Registru indisponibil sau configurat greșit
ℹ tests 18
ℹ suites 5
ℹ pass 18
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

## 2. Cronologia unei trimiteri cu toate tipurile de eșec

Comandă: `npm run demo:ext`

Scenariul simulatorului combină, în ordine, **timeout**, **limitare de trafic (429, cu
`Retry-After: 3`)**, **eroare 503** și **răspuns pierdut**, apoi `ok`. Pauzele sunt reale, dar
scurtate față de producție (timeout 1 s, backoff de la 0,5 s).

```
Demonstrație pachet EXT: Registrul PSI cu eșecuri simulate
Scenariu simulator: timeout → rate_limit → error_503 → lost_response → ok
Setări: timeout 1 s, backoff 0,5 s → 1 s → 2 s → 4 s, maximum 5 încercări; Registrul cere Retry-After: 3 s la 429

  +0.34s  inspectorul a trimis inspecția a58a8bec… spre revizie
  +0.35s  coordonatorul a aprobat → status „approved”, trimitere „pending”
  +1.36s  server: încercarea 1 a eșuat (timeout după 1000 ms); următoarea peste 500 ms
  +1.87s  server: încercarea 2 a eșuat (429 limitare de trafic); următoarea peste 3000 ms
  +4.88s  server: încercarea 3 a eșuat (eroare 503 la Registru); următoarea peste 2000 ms
  +6.89s  server: încercarea 4 a eșuat (eroare de rețea: UND_ERR_SOCKET); următoarea peste 4000 ms
 +10.91s  server: trimisă la încercarea 5 (PSI-2026-000001, duplicat)

Rezultat
  stare trimitere:        sent
  încercări:              5
  chitanță:               PSI-2026-000001
  cereri primite de Registru:   5
  înregistrări în Registru:     1  (trebuie să fie 1)
```

**Ce arată:**
- încercările sunt limitate (5) și distanțate exponențial: 0,5 s, apoi 2 s și 4 s;
- după 429, pauza e de **3 s**, cât a cerut Registrul prin `Retry-After`, nu de 1 s cât ar fi fost
  backoff-ul la acel pas (un 429 fără antet primește backoff-ul normal: T-EXT-15);
- după timeout și după răspunsul pierdut, Registrul înregistrase deja inspecția; ultima încercare
  primește un **răspuns duplicat** (`duplicate: true`) cu aceeași chitanță;
- rezultatul: **5 cereri, o singură înregistrare, o singură chitanță**.
