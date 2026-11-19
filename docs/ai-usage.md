# Utilizarea instrumentelor AI

## 1. Rezumat

| Instrument | Folosit pentru | Cum am verificat |
|---|---|---|
| Claude (Anthropic), asistent cu acces la fișiere și terminal | analiza enunțului și a specificațiilor; propuneri de design; generarea codului (server, interfață, teste, testul de încărcare); documentație | am comparat documentele cu cerințele din enunț, specificația generală și catalogul de pachete; am citit codul; am rulat local testele, coverage-ul, testele Playwright, testul de încărcare și aplicația în mod producție |
| O sesiune AI separată, fără contextul proiectului | verificare independentă: a primit doar cerințele și proiectul, a rulat totul și a verificat cerință cu cerință | fiecare problemă semnalată a fost reprodusă de noi înainte de corectare |

**Reguli de lucru:**
- Nimic generat de AI nu intră în repository fără să fie citit de cel puțin un membru al echipei.
- Codul se acceptă doar dacă testele trec local. Testele șterse sau slăbite nu se acceptă.
- Cerințele vin din documentele profesorului, nu din propunerile agentului; la o diferență,
  documentele profesorului au prioritate.
- Un defect se corectează abia după ce există un test care îl reproduce (testul eșuează pe
  varianta veche și trece pe cea nouă).

**Principalele defecte prinse prin verificare și corectate:**

| Zonă | Problemă | Cum a fost găsită | Remediere |
|---|---|---|---|
| Bază de date | tranzacțiile simultane pe SQLite eșuau („database is locked”) | experiment cu tranzacții paralele | toate scrierile trec prin `db.write()`, una câte una; WAL |
| Performanță | lipseau indexurile pe `inspections`; la 60 cereri/s p95 ajungea la secunde | testul de încărcare | indexuri pe `(inspector_id, updated_at)`, `status`, `due_date`; comparația e reproductibilă cu `npm run load:fara-indexuri` |
| Sincronizare | conflictul „în ordinea inversă” nu era anunțat pe dispozitivul vechi | verificarea independentă, apoi test Playwright | clientul ține minte ce a trimis (`sentByMe`); sincronizare periodică la 30 s (T-SYNC-12, T-OFF-05b) |
| Sincronizare | o modificare salvată în timpul unei sincronizări rămânea netrimisă | verificarea independentă | rundă suplimentară automată (T-SYNC-10) |
| Ceasul telefonului | un ceas greșit putea câștiga conflicte; măsurarea trebuie să fie stabilă și pe rețea lentă | teste pe motorul de sincronizare | corecție față de antetul `Date`, cu histerezis și prag adaptat duratei cererii (T-SYNC-13…21) |
| Securitate | login fără limită de încercări; timpul de răspuns arăta dacă un cont există | măsurare | limită de încercări, hash fals pentru conturi inexistente (T-SEC-02…05) |
| EXT | un 429 fără `Retry-After` ducea la reîncercări imediate | test pe procesor | backoff normal când antetul lipsește; `Retry-After` și ca dată HTTP (T-EXT-15) |
| Interfață | două tab-uri pe același dispozitiv își suprascriau draft-urile | verificarea independentă | un singur tab activ, prin Web Locks API (T-OFF-11) |

---

## 2. Cazuri tehnice semnificative (unul per student)

### Cazul 1 — Lipan Florinel Vlad: designul inițial nu respecta specificația generală

| Etapă | Descriere |
|---|---|
| **Cerință** | Proiectarea aplicației pentru tema „Inspecții de teren offline”, cu pachetele OFF și EXT. Inițial aveam doar fișa temei; specificația generală și catalogul de pachete le-am găsit ulterior. |
| **Intervenția agentului** | Pe baza fișei temei și a cursurilor, agentul a propus o variantă minimală: JavaScript fără framework, SQLite accesat direct, `localStorage` pentru datele offline și un simulator de erori pe propriul API. |
| **Inspecție** | Am comparat propunerea, punct cu punct, cu `00-general-specifications.md` și `01-architectural-challenges.md`. |
| **Defecte găsite** | 1) Specificația impune React + Vite și Sequelize. 2) EXT cere un serviciu extern cu timeout, erori, rate limit și răspuns duplicat, nu erori pe propriul API. 3) Fluxul trebuia să aibă mai multe stări, cu reguli explicite. 4) Lipseau paginarea/filtrarea, pragurile de coverage, testul de încărcare pe 3 niveluri și structura obligatorie de documente. |
| **Remediere** | Am refăcut designul pornind de la specificația generală: React + Vite, Sequelize + SQLite, IndexedDB, un Registru PSI simulat separat cu scenarii deterministe de eșec, 5 stări cu aprobare/returnare, c8 cu pragurile 70%/60%, Artillery pe 3 niveluri. Am adăugat în `requirements.md` un tabel de trasabilitate cerință → secțiune. |
| **Rezultat** | Designul acoperă cerințele din cele trei documente (`requirements.md`, secțiunea 10). Lecția: cerințele trebuie validate față de sursa oficială înainte de a construi pe un design. |

### Cazul 2 — Lungu-Filip Mihai: conflictul „în ordinea inversă” nu era anunțat

| Etapă | Descriere |
|---|---|
| **Cerință** | OFF: la un conflict între două dispozitive, câștigă modificarea cea mai nouă, iar utilizatorul a cărui variantă a pierdut trebuie anunțat. |
| **Intervenția agentului** | Agentul a implementat motorul de sincronizare (`client/src/lib/sync.js`): coada de trimis, `PUT` idempotent și mesajul de conflict când serverul răspunde `applied: false` cu o variantă mai nouă. |
| **Inspecție** | Am testat conflictul în ambele ordini. Ordinea normală (varianta nouă ajunge prima pe server) funcționa. Ordinea inversă: varianta veche ajunge prima și e acceptată, apoi o înlocuiește varianta nouă de pe celălalt dispozitiv. |
| **Defect găsit** | În ordinea inversă, dispozitivul vechi nu afla niciodată că modificarea lui a fost înlocuită: serverul îi acceptase cererea, deci nu avea ce conflict să afișeze. După remedierea inițială, mesajul apărea doar la un click pe „Sincronizează”. |
| **Remediere** | Clientul ține minte ce a trimis și a fost acceptat (`sentByMe`); la următoarea descărcare, dacă pe server e altă variantă, afișează conflictul. Am adăugat sincronizarea periodică la 30 s și la revenirea în aplicație, ca mesajul să apară fără click. Teste: T-SYNC-12 (motorul de sincronizare) și T-OFF-05b (Playwright, fără click). |
| **Rezultat** | Mesajul apare pe dispozitivul vechi în cel mult 30 s, în ambele ordini. Am verificat și manual, în Chrome, cu o fereastră normală și una incognito. |

---

## 3. Contribuții individuale

| Membru | Responsabilități principale |
|---|---|
| Lipan Florinel Vlad | backend: API, autentificare, reguli de business, mașina de stări; pachetul EXT (simulatorul Registrului și integrarea) |
| Lungu-Filip Mihai | frontend React; pachetul OFF (IndexedDB, service worker, sincronizare); teste Playwright |
| Împreună | documentație, testul de încărcare, demonstrația |

Contribuțiile se văd în istoricul Git (commit-uri de pe contul fiecăruia).
