# Capacitate și performanță — FireCheck

Model de sarcină (M1) și rezultatele măsurate (M3). Raportul complet, generat automat:
[`evidence/load-results.md`](evidence/load-results.md).

## 1. Scenariul de referință

O firmă regională de servicii PSI.

| Mărime | Valoare | Justificare |
|---|---|---|
| Inspectori | 50 | firmă regională |
| Coordonatori | 5 | ~1 la 10 inspectori |
| Utilizatori simultani la vârf | 55 | toți conectați la finalul turei |
| Inspecții pe inspector, pe zi | 8 | ~1 oră pe clădire |
| Inspecții pe zi | 400 (~100.000 pe an) | 50 × 8 |
| Volum în baza de date pentru test | 5.000 inspecții | ~2,5 luni de date; seed cu `--inspections 5000` |
| Mărime inspecție fără poze | ~2 KB | 6 întrebări cu observații scurte |
| Mărime inspecție cu poză | ~100–270 KB | poză micșorată la ≤ 640 px; maximum 3 × 200 KB |

## 2. Tipul operațiilor

| Operație | Pe zi (estimat) | Pondere în testul de încărcare |
|---|---:|---:|
| `GET /api/inspections` (sincronizarea listei, ca în aplicație: `pageSize=100`) | ~1.500 | 30% |
| `GET /api/inspections/{id}` (detaliile inspecțiilor modificate) | ~1.000 | 13% |
| `GET /api/templates` | ~300 | 2% |
| `PUT` inspecție nouă (creată offline) | ~400 | 15% |
| `PUT` actualizare a unei inspecții existente | ~800 | 15% |
| `PUT` retransmis (răspuns pierdut, aceeași cerere de două ori) | ~100 | 5% |
| `PUT` cu o poză (~100 KB) | ~200 | 10% |
| `POST /api/auth/login` | ~60 | 5% |
| ecranele coordonatorului (raport, listă filtrată) | ~200 | 5% |

Ponderea login-ului și a coordonatorului e mai mare în test decât în realitate, intenționat: sunt
cele mai scumpe cereri (scrypt, respectiv agregări), deci testul e mai pesimist.

## 3. Vârful de sarcină

La finalul turei, inspectorii ies din subsoluri și se reconectează aproape simultan.

- Cel mai rău caz: toți cei 50, fiecare cu 8 inspecții în coadă, în 30 de secunde →
  400 `PUT` în 30 s ≈ **13 cereri/s**.
- După sincronizare, fiecare descarcă lista (~3 cereri) → 150 de cereri în aceleași 30 s ≈
  **5 cereri/s**.
- Sincronizarea periodică (la 30 s, cât aplicația e deschisă) adaugă o listare pe inspector, adică
  ~1,7 cereri/s pentru 50 de inspectori. Șabloanele se cer doar la nevoie (cel mult o dată la
  10 minute), iar detaliile doar pentru inspecțiile modificate.
- **Vârf estimat: ~20 cereri/s** (13 + 5 + 1,7), adică ~0,40 cereri/s pe inspector. E exact
  nivelul L2; L3 e de 3 ori peste.

## 4. Obiective (SLO)

| Indicator | Obiectiv, la nivelul de vârf (L2) |
|---|---|
| Latență p50 | < 100 ms |
| Latență p95 | < 300 ms |
| Rata erorilor (fără simulator de erori) | < 1% |

## 5. Testul de încărcare

**Instrument:** Artillery, orchestrat de `load/run.js`. **Comenzi:** `npm run load` (~4 minute) și
`npm run load:fara-indexuri` (același test, cu indexurile șterse, pentru comparație).
Scriptul pregătește singur totul: o bază de date separată (`data/load.sqlite`) cu 5.000 de
inspecții, 50 de inspectori și un coordonator, serverul pornit cu `METRICS=1` și tokenurile.
Se rulează pe un calculator fără alte aplicații grele.

| Nivel | Cereri/s | Durată | Semnificație |
|---|---:|---|---|
| **L1** normal | 5 | 60 s | o zi obișnuită, cu marjă |
| **L2** vârf | 20 | 60 s | vârful estimat (~20 cereri/s) |
| **L3** stres | 60 | 60 s | ~3× vârful, pentru a vedea unde se degradează |

Între niveluri: 10 s de pauză. Utilizatorii virtuali urmează amestecul din secțiunea 2.

**Se raportează pentru fiecare nivel:** throughput (cereri/s reale), p50, p95, p99, rata erorilor,
codurile HTTP, p95 pe fiecare tip de cerere, CPU și memoria procesului Node (`METRICS=1` le scrie
la fiecare secundă). Raportul, inclusiv estimarea capacității și blocajul, e **generat automat din
date** în `docs/evidence/load-results.md`.

## 6. Rezultate (M3)

Mediul: Linux, Intel Xeon 2,1 GHz cu **2 nuclee**, 7,8 GB RAM, Node.js 22.23; Artillery rulează pe
același calculator cu serverul. **Rezultatele nu se compară între calculatoare diferite.**
Rapoartele complete, cu p95 pe fiecare tip de cerere: [`evidence/load-results.md`](evidence/load-results.md)
și [`evidence/load-results-fara-indexuri.md`](evidence/load-results-fara-indexuri.md).

**Cu indexuri (configurația normală):**

| Nivel | Cereri/s țintă | Cereri/s reale | p50 (ms) | p95 (ms) | p99 (ms) | Erori | CPU mediu | Memorie maximă | SLO |
|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| L1 normal | 5 | 5,3 | 8,9 | 23,8 | 44,3 | 0% | 7% | 195 MB | ✅ |
| L2 vârf | 20 | 21,1 | 7,9 | 36,2 | 49,9 | 0% | 21% | 214 MB | ✅ |
| L3 stres | 60 | 63,2 | 7,0 | 51,9 | 77,5 | 0% | 52% | 214 MB | ✅ |

**Experimentul de comparație: fără indexuri** (`npm run load:fara-indexuri`):

| Nivel | p50 (ms) | p95 (ms) | Erori | CPU mediu | SLO |
|---|---:|---:|---:|---:|:---:|
| L1 normal | 10,9 | 24,8 | 0% | 6% | ✅ |
| L2 vârf | 10,9 | 40,9 | 0% | 27% | ✅ |
| L3 stres | 113,3 | 1.652,8 | 0% | 88% | ❌ |

Rezultatele variază de la o rulare la alta: în alte rulări fără indexuri, p95 la L3 a fost între
~0,4 s și ~5 s, uneori cu erori. Concluzia e aceeași în toate: fără indexuri, L3 nu respectă
obiectivele, iar procesorul ajunge la ~90%.

**Ce arată comparația.** Testul de încărcare a identificat blocajul: prima rulare completă nu a
respectat obiectivele la L3, pentru că indexurile prevăzute în schema din M1 nu erau încă create în
modelele Sequelize. Fiecare listare citea tot
tabelul (~70 MB cu poze), iar costul creștea cu fiecare inspecție adăugată în timpul testului.
Cu indexurile pe `(inspector_id, updated_at)`, `status` și `due_date`, la același nivel procesorul
scade de la 88% la 52%, iar p95 de la ~1,7 s la ~52 ms.

## 7. Estimarea capacității

1. **Capacitatea măsurată** = cel mai mare nivel la care sunt îndeplinite obiectivele din
   secțiunea 4: **~63 cereri/s** (L3).
2. **Capacitatea estimată.** Node execută codul aplicației pe un singur fir, deci procesorul e
   resursa care se epuizează prima. CPU-ul măsurat e al întregului proces (inclusiv hash-urile
   scrypt din thread pool). La L3, serverul a folosit 52% dintr-un nucleu, adică ~0,83% per
   cerere/s. Extrapolat liniar până la 70% dintr-un nucleu (30% rezervă), capacitatea susținută
   estimată e **~85 cereri/s**.
3. **Inspectori deserviți la vârf:** ≈ 85 / 0,40 ≈ **~210 inspectori** (sigur, din măsurare:
   ~157), față de 50 în scenariul de referință.
4. **Comparația cu obiectivul** (~20 cereri/s): marjă măsurată **3,2×**, estimată **~4,2×**.
5. **Cât de credibilă e extrapolarea.**
   - Procesorul per cerere/s **scade** de la un nivel la altul: 1,27% → 0,98% → 0,83%. Costurile fixe
     ale procesului (temporizatoare, colectarea memoriei) se împart la mai multe cereri. Dacă trendul
     continuă, capacitatea reală e mai mare decât cea estimată, deci extrapolarea de la cel mai mare
     nivel e prudentă.
   - Estimarea variază între rulări: 75–88 cereri/s în rulările noastre și ale verificărilor
     independente. Incertitudinea e deci de ordinul ±20%.
   - Experimentul fără indexuri arată limita metodei: acolo procesorul per cerere **creștea** cu
     datele, iar o extrapolare de la L2 ar fi supraestimat capacitatea; la 60 cereri/s sistemul s-a
     degradat.
   - Punctul real de saturare nu e căutat: experimentul de saturare e cerut doar de pachetul SCL.

## 8. Blocaj probabil

**Ipoteza din M1:** scrierile serializate în SQLite și corpurile mari (poze).

**Ce au arătat măsurătorile:**
- **Primul blocaj real a fost altul: lipsa indexurilor** (secțiunea 6). Fără ele, procesorul se
  satura la 60 cereri/s.
- **După corectare, resursa care crește cel mai repede e procesorul procesului Node** (7% → 21% → 52%).
  El va fi primul epuizat.
- **Cele mai lente cereri sunt `POST login`** (p95 ~105 ms la L3). E intenționat: hash-ul scrypt
  consumă procesor ca să încetinească ghicirea parolelor. Rulează în thread pool-ul libuv, nu pe
  firul principal, dar ia din același procesor (2 nuclee aici). Urmează `GET raport` (agregări) și
  `PUT cu poză` (corpuri mari).
- **Scrierile serializate în SQLite nu sunt încă o problemă** la această sarcină: `PUT`-urile au
  p95 de cel mult ~40 ms la L3 (cel mai mare, cu poză).

**Opțiuni, dacă ar fi nevoie de mai mult** (documentate, neimplementate): mai multe procese Node
(cluster) cu o bază de date care acceptă scrieri concurente; limitarea rafalelor de login (hash-ul
e deja în afara firului principal); pozele în fișiere separate, în loc de JSON în rândul inspecției.
