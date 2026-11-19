# Rezultatele testului de încărcare

Generat automat de `npm run load` (load/run.js). Fiecare rulare rescrie acest
fișier. **Rezultatele depind de calculator** și nu se compară între calculatoare diferite.

## Mediul de test

| | |
|---|---|
| Procesor | Intel(R) Xeon(R) Processor @ 2.10GHz (2 nuclee logice) |
| Memorie RAM | 7.8 GB |
| Sistem de operare | Linux 6.18.44-fc-v378 (linux/x64) |
| Node.js | v22.23.4 |
| Data rulării | 2026-11-11 20:22 UTC |
| Date | 5.000 de inspecții, 50 de inspectori, 1 coordonator; SQLite pe disc (WAL) |
| Durata unui nivel | 60 s, cu 10 s de pauză între niveluri |
| Generatorul de trafic | Artillery, pe același calculator cu serverul (îi ia și el din procesor) |

## Amestecul de cereri

| Scenariu | Pondere | Ce reproduce |
|---|---:|---|
| GET listă (sincronizare) | 30% | descărcarea inspecțiilor proprii după reconectare, ca în aplicație (`pageSize=100`) |
| GET detalii | 13% | descărcarea unei inspecții modificate |
| GET șabloane | 2% | descărcarea șabloanelor (la prima sincronizare și cel mult o dată la 10 minute) |
| PUT inspecție nouă | 15% | o inspecție creată offline, trimisă la reconectare |
| PUT actualizare | 15% | o nouă modificare a unei inspecții existente (marcaj de timp nou; conflicte rezolvate cu R2) |
| PUT retransmisie | 5% | același PUT trimis de două ori (răspuns pierdut); al doilea primește `applied: false` |
| PUT cu poză | 10% | inspecție nouă cu o poză de ~100 KB |
| POST login | 5% | autentificare (hash scrypt, cea mai scumpă operație pentru procesor) |
| GET raport, GET listă (coordonator) | 5% | ecranele coordonatorului |

## Rezultate pe niveluri

| Nivel | Cereri/s țintă | Cereri/s reale | Cereri | p50 (ms) | p95 (ms) | p99 (ms) | Erori | CPU mediu / maxim | Memorie maximă | Obiectiv (SLO) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| L1 normal | 5 | 5.3 | 315 | 8.9 | 23.8 | 44.3 | 0 (0.00%) | 7% / 86% | 195 MB | ✅ |
| L2 vârf | 20 | 21.1 | 1268 | 7.9 | 36.2 | 49.9 | 0 (0.00%) | 21% / 36% | 214 MB | ✅ |
| L3 stres | 60 | 63.2 | 3790 | 7.0 | 51.9 | 77.5 | 0 (0.00%) | 52% / 68% | 214 MB | ✅ |

Obiective (docs/capacity.md, secțiunea 4): p50 < 100 ms, p95 < 300 ms, erori < 1%.
CPU: procentul dintr-un nucleu folosit de procesul Node al serverului (100% = un nucleu plin; poate trece de 100%,
pentru că include și thread pool-ul în care rulează hash-urile scrypt).
Coduri HTTP la L3: 200: 2666, 201: 1124.

## p95 pe tipuri de cereri (ms)

| Tip | L1 | L2 | L3 |
|---|---:|---:|---:|
| GET listă (sincronizare) | 13.1 | 15.0 | 21.1 |
| GET detalii | 12.1 | 10.9 | 19.1 |
| GET șabloane | 4.0 | 7.0 | 16.9 |
| PUT inspecție nouă | 16.9 | 16.0 | 32.1 |
| PUT actualizare | 10.9 | 13.1 | 24.8 |
| PUT retransmisie | 13.1 | 15.0 | 27.9 |
| PUT cu poză | 19.9 | 21.1 | 39.3 |
| POST login | 54.1 | 55.2 | 104.6 |
| GET raport (coordonator) | 19.1 | 34.1 | 73.0 |
| GET listă (coordonator) | 7.9 | 10.9 | 29.1 |

## Estimarea capacității

- **Măsurat:** obiectivele sunt respectate până la **63.2 cereri/s** (nivelul L3).
- **Estimat:** la L3, procesorul serverului a lucrat 52% dintr-un nucleu, adică ~0.83% per cerere/s. Extrapolat liniar până la 70% dintr-un nucleu, capacitatea susținută estimată e **~85 cereri/s**.
- **Inspectori deserviți la vârf:** ≈ 85 / 0.4 ≈ **212 inspectori** (măsurat sigur: 157).
- **Față de obiectivul scenariului** (20 cereri/s la vârf): marjă măsurată **3.2×**, estimată **4.2×**.
- **Procesor per cerere/s, pe niveluri:** L1 1.27% → L2 0.98% → L3 0.83%. Scade odată cu sarcina (costurile fixe ale procesului, ca temporizatoarele și colectarea memoriei, se împart la mai multe cereri), deci extrapolarea de la cel mai mare nivel e prudentă.
- **Limitele estimării:** e o extrapolare, nu o măsurătoare; presupune că nu apare alt blocaj înainte (de exemplu scrierile serializate în SQLite) și variază de la o rulare la alta (de ordinul ±20%). Punctul real de saturare nu e căutat: experimentul de saturare e cerut doar de pachetul SCL.

## Blocaj probabil

- **Procesor:** L1 7% → L2 21% → L3 52% (mediu, dintr-un nucleu). Crește odată cu sarcina; e resursa care se va epuiza prima (Node rulează codul aplicației pe un singur fir).
- **Cele mai lente cereri** la L3: **POST login** (p95 104.6 ms).
- **Interpretare:** autentificarea e lentă intenționat: hash-ul scrypt consumă procesor ca să încetinească ghicirea parolelor. Rulează în thread pool-ul libuv, nu pe firul principal, dar ia din același procesor ca restul cererilor.
