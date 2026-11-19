# Rezultatele testului de încărcare — FĂRĂ indexuri

Generat automat de `npm run load:fara-indexuri` (load/run.js). Fiecare rulare rescrie acest
fișier. **Rezultatele depind de calculator** și nu se compară între calculatoare diferite.

**Variantă de experiment:** indexurile de pe tabela `inspections` sunt șterse din baza de date de test
(idx_inspections_inspector_updated, idx_inspections_status, idx_inspections_due_date). Comparația cu rularea normală: [`load-results.md`](load-results.md).

## Mediul de test

| | |
|---|---|
| Procesor | Intel(R) Xeon(R) Processor @ 2.10GHz (2 nuclee logice) |
| Memorie RAM | 7.8 GB |
| Sistem de operare | Linux 6.18.44-fc-v378 (linux/x64) |
| Node.js | v22.23.4 |
| Data rulării | 2026-11-11 20:26 UTC |
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
| L1 normal | 5 | 5.2 | 312 | 10.9 | 24.8 | 47.9 | 0 (0.00%) | 6% / 21% | 199 MB | ✅ |
| L2 vârf | 20 | 20.8 | 1248 | 10.9 | 40.9 | 54.1 | 0 (0.00%) | 27% / 43% | 213 MB | ✅ |
| L3 stres | 60 | 62.6 | 3757 | 113.3 | 1652.8 | 2143.5 | 0 (0.00%) | 88% / 115% | 268 MB | ❌ |

Obiective (docs/capacity.md, secțiunea 4): p50 < 100 ms, p95 < 300 ms, erori < 1%.
CPU: procentul dintr-un nucleu folosit de procesul Node al serverului (100% = un nucleu plin; poate trece de 100%,
pentru că include și thread pool-ul în care rulează hash-urile scrypt).
Coduri HTTP la L3: 200: 2748, 201: 1009.

## p95 pe tipuri de cereri (ms)

| Tip | L1 | L2 | L3 |
|---|---:|---:|---:|
| GET listă (sincronizare) | 18.0 | 24.8 | 1755.0 |
| GET detalii | 7.0 | 8.9 | 1620.0 |
| GET șabloane | 4.0 | 6.0 | 1176.4 |
| PUT inspecție nouă | 19.1 | 16.0 | 1652.8 |
| PUT actualizare | 10.9 | 13.1 | 1686.1 |
| PUT retransmisie | 15.0 | 16.9 | 1652.8 |
| PUT cu poză | 21.1 | 22.0 | 1495.5 |
| POST login | 58.6 | 66.0 | 1022.7 |
| GET raport (coordonator) | 24.8 | 34.8 | 3011.6 |
| GET listă (coordonator) | 10.9 | 13.1 | 1587.9 |

## Estimarea capacității

- **Măsurat:** obiectivele sunt respectate până la **20.8 cereri/s** (nivelul L2).
- **Estimat:** la L2, procesorul serverului a lucrat 27% dintr-un nucleu, adică ~1.27% per cerere/s. Extrapolat liniar până la 70% dintr-un nucleu, capacitatea susținută estimată e **~55 cereri/s**.
- **Inspectori deserviți la vârf:** ≈ 55 / 0.4 ≈ **137 inspectori** (măsurat sigur: 52).
- **Față de obiectivul scenariului** (20 cereri/s la vârf): marjă măsurată **1.0×**, estimată **2.7×**.
- **Procesor per cerere/s, pe niveluri:** L1 1.25% → L2 1.27% → L3 1.41%. Crește odată cu sarcina, deci extrapolarea liniară poate supraestima capacitatea.
- **Limitele estimării:** e o extrapolare, nu o măsurătoare; presupune că nu apare alt blocaj înainte (de exemplu scrierile serializate în SQLite) și variază de la o rulare la alta (de ordinul ±20%). Punctul real de saturare nu e căutat: experimentul de saturare e cerut doar de pachetul SCL.

## Blocaj probabil

- **Procesor:** L1 6% → L2 27% → L3 88% (mediu, dintr-un nucleu). Firul principal Node e aproape plin: el e blocajul.
- **Cele mai lente cereri** la L3: **GET raport (coordonator)** (p95 3011.6 ms).
- **Interpretare:** citirile domină: fără indexuri potrivite, fiecare listare citește mult din tabel.
