# ADR-001 — Funcționare offline: IndexedDB, service worker, PUT idempotent și „ultima modificare câștigă”

**Status:** Implementat și verificat (M3).
**Pachet:** OFF

## Problemă

Inspectorii lucrează în locuri fără semnal. Aplicația trebuie să se deschidă, să permită
completarea și crearea inspecțiilor fără rețea, să păstreze datele la reîncărcare și restart și
să le sincronizeze ulterior fără duplicate, cu o regulă clară pentru conflicte.

## Alternative

### 1. Unde se păstrează datele local

| Variantă | Pro | Contra |
|---|---|---|
| **IndexedDB prin `idb-keyval`** | capacitate mare (sute de MB); stochează și pozele; API la fel de simplu ca `localStorage` (`get` / `set`) | asincron |
| `localStorage` | cel mai simplu API, sincron | ~5 MB pe site, doar text; blochează firul principal la scrieri mari (poze) |
| IndexedDB prin Dexie | interogări, indexuri, versiuni de schemă | bibliotecă mai mare; nu avem nevoie de interogări locale |

### 2. Cum se încarcă aplicația offline

| Variantă | Pro | Contra |
|---|---|---|
| **`vite-plugin-pwa` (service worker generat)** | integrat în build-ul Vite; lista de fișiere de pus în cache se generează automat la fiecare build | o dependență în plus |
| service worker scris de mână | control complet | lista de fișiere (cu hash-uri generate de Vite) trebuie întreținută manual |
| fără service worker | zero cod | reîncărcarea offline afișează eroarea browserului, deci cerința nu e îndeplinită |

### 3. Cum se evită duplicatele

| Variantă | Pro | Contra |
|---|---|---|
| **UUID generat de client + `PUT /inspections/{id}`** | idempotent prin definiție (Cursul 05); aceeași operație pentru creare și editare; cheia primară o garantează în baza de date | clientul generează ID-urile (`crypto.randomUUID()`, inclus în browser) |
| `POST` + antet `Idempotency-Key` + tabel de chei | model folosit de API-uri mari | tabel în plus, expirarea cheilor |
| detectarea duplicatelor după conținut | nimic pe client | două inspecții reale identice ar fi considerate duplicate |

### 4. Politica de conflicte

| Variantă | Pro | Contra |
|---|---|---|
| **Ultima modificare câștigă (pe toată inspecția), după `clientUpdatedAt`, + blocare în revizie** | deterministă, simplă, fără ecran de rezolvare; ignoră automat cererile vechi reîncercate | modificarea mai veche se pierde; depinde de ceasul dispozitivului |
| versiune numerică + 409 + alegerea utilizatorului | nimic nu se pierde fără știrea utilizatorului | ecran de conflict și logică în plus pe client |
| îmbinare pe fiecare câmp | păstrează modificări de pe ambele dispozitive | mult mai complexă (extensie opțională a temei) |

### 5. Când se sincronizează

| Variantă | Pro | Contra |
|---|---|---|
| **la pornire + evenimentul `online` + după fiecare salvare online + buton** | funcționează în toate browserele | doar cu aplicația deschisă |
| Background Sync API | funcționează și cu aplicația închisă | nesuportat în Firefox și Safari |

## Decizie

IndexedDB prin `idb-keyval`, service worker generat cu `vite-plugin-pwa`, UUID de client cu
`PUT` idempotent, „ultima modificare câștigă” după `clientUpdatedAt` (cu ceasul corectat față de
server, cu histerezis) și blocarea inspecțiilor `submitted`/`approved`, cu regula că o editare e
mereu mai nouă decât varianta pe care se bazează; sincronizare la pornire, la `online`, după
salvări, la revenirea în aplicație, la 30 s cât e deschisă și online, și manual.

**De ce e suficient:** o inspecție aparține unui singur inspector, iar coordonatorul nu îi
modifică răspunsurile. Conflictele reale apar doar între dispozitivele aceluiași inspector sau din
cereri vechi reîncercate. „Ultima modificare câștigă” le rezolvă determinist, iar blocarea în
revizie împiedică orice conflict cu decizia coordonatorului.

## Experiment / test

Testele T-OFF-01…11 (Playwright) și T-IDEM, T-CONF, T-SYNC (API și modulul de sincronizare) din
[`testing.md`](../testing.md).

**Rezultate (M3):**
- 11/11 teste Playwright trec: mod avion, reîncărcare offline, restart de browser, sincronizare
  automată la reconectare, răspuns pierdut + reîncercare, conflict între două dispozitive **în
  ambele ordini**, conflict cu o inspecție deja trimisă, server care nu răspunde deși rețeaua pare
  online, inspecție trimisă offline (rămâne blocată), al doilea tab pe același dispozitiv.
- Rularea cu **10 minute offline** și reîncărcare trece (`npm run test:off-10min`, dovada în
  [`evidence/off-10min.md`](../evidence/off-10min.md)).
- După retransmisie (răspunsul primului `PUT` pierdut), pe server există **un singur rând**, iar
  clientul nu afișează un fals conflict (T-OFF-04, T-SYNC-03).
- Testele de duplicate pe API: 5 `PUT` identice, secvențial sau simultan → 1 rând (T-IDEM-01/02).

Detalii: [`evidence/off-M3.md`](../evidence/off-M3.md).

**Ce am învățat la implementare și testare:**
- Răspunsul `applied: false` are două cauze diferite: propria cerere, primită deja (retransmisie)
  sau o modificare mai nouă de pe alt dispozitiv. Clientul le deosebește comparând marcajul de timp
  primit cu cel trimis; altfel ar afișa conflicte false după fiecare reîncercare.
- Un conflict se poate rezolva și „în ordinea inversă”: varianta veche e acceptată întâi, apoi e
  înlocuită de cea nouă. Pentru acest caz, clientul ține minte ce a trimis (`sentByMe`) și află la
  următoarea descărcare că a fost înlocuit.
- O modificare făcută chiar în timpul trimiterii nu trebuie nici ștearsă la confirmare, nici lăsată
  să aștepte: draft-ul se șterge doar dacă marcajul lui e cel trimis, iar sincronizarea face singură
  o rundă suplimentară (T-SYNC-10).
- `navigator.onLine` nu garantează că serverul răspunde. Reîncercarea periodică la 30 s acoperă
  semnalul slab (T-OFF-09).
- **Corecția de ceas trebuie să fie stabilă.** Recalculată la fiecare răspuns, la un ceas aflat
  lângă pragul de 2 s ar sări între 0 și ~2,5 s, iar o editare ar putea primi un marcaj mai vechi
  decât precedenta. De aceea corecția are histerezis, iar o editare e mereu mai nouă decât varianta
  pe care se bazează (T-SYNC-14, T-SYNC-15).
- **Măsurarea ceasului se face la sosirea antetelor și doar pentru încercarea reușită.** Altfel un
  răspuns lent (poze, semnal slab) sau un timeout urmat de reîncercare ar arăta ca un ceas „înainte”
  (T-SYNC-17, T-SYNC-20). Răspunsurile lente nu se ignoră, ci se folosesc cu un prag mărit cu eroarea
  posibilă a măsurătorii, ca un ceas greșit cu minute întregi să fie corectat și pe o rețea lentă
  (T-SYNC-21).
- **Mai multe tab-uri** și-ar suprascrie draft-urile, pentru că fiecare ține starea în memorie.
  În loc de o sincronizare între tab-uri, aplicația permite un singur tab activ (Web Locks API).

## Limite

- Depinde de ceasul dispozitivului. Corecția față de server (R8) funcționează după prima
  conexiune; până atunci, serverul respinge doar marcajele cu peste 5 minute în viitor.
- Modificarea mai veche de pe un alt dispozitiv se pierde (cu mesaj).
- Login-ul inițial cere rețea; sincronizarea are loc doar cu aplicația deschisă.
- Browserul poate elibera spațiul IndexedDB când discul e plin.
- În browserele fără Web Locks API (foarte vechi), două tab-uri pot suprascrie draft-urile unul altuia.
