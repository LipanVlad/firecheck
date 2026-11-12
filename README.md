# FireCheck — inspecții PSI de teren, offline

Aplicație web în care inspectorii completează checklist-uri de siguranță la incendiu
(stingătoare, hidranți, căi de evacuare) **fără conexiune stabilă la internet**. Datele se
sincronizează când rețeaua revine, iar inspecțiile aprobate sunt transmise automat unui registru
extern.

Proiect pentru disciplina **Tehnologii Web**, anul universitar 2026–2027.
**Temă:** Inspecții de teren offline · **Pachete obligatorii:** OFF + EXT

## Echipa

| Nume | Grupa | Seria | Responsabilități principale |
|---|---|---|---|
| Lipan Florinel Vlad | 1082 | E | backend, reguli de business, pachetul EXT |
| Lungu-Filip Mihai | 1082 | E | frontend, pachetul OFF, teste end-to-end |

## Pe scurt

- **Coordonatorul** creează șabloane de checklist, asignează inspecții, le aprobă sau le
  returnează și vede raportul central.
- **Inspectorul** își vede doar inspecțiile proprii și le completează, inclusiv offline, cu poze
  opționale.
- Datele introduse offline rezistă la reîncărcarea paginii și la restartul browserului.
- Retransmiterea aceleiași inspecții nu produce duplicate; conflictele se rezolvă după regula
  „ultima modificare câștigă”.
- Inspecțiile aprobate sunt transmise **Registrului PSI** (serviciu extern simulat local), cu
  reîncercări limitate și fără înregistrări duplicate.

## Tehnologii

Node.js LTS · Express 5 · Sequelize + SQLite · Joi · React + Vite · IndexedDB · service worker ·
`node:test` · c8 · Playwright · Artillery

## Stadiu

| Etapă | Conținut | Stare |
|---|---|---|
| **M1** | cerințe, fluxuri, invariante, schemă, API, arhitectură, alternative pentru pachete, model de sarcină, plan de teste, schelet executabil | ✅ |
| **M2** | API și persistență, securitate de bază, reguli esențiale, teste de unitate și integrare, coverage inițial, pachetul EXT verificat | ✅ |
| **M3** | aplicația completă, pachetul OFF, teste E2E, coverage și lacune, test de încărcare, ADR-uri finale, demonstrație | ✅ |

## Cerințe preliminare

- [Node.js](https://nodejs.org) **LTS** (versiunea 22.9 sau mai nouă; testat pe 22, 24 și 26)
- [Git](https://git-scm.com)

## Instalare și rulare

```bash
git clone <adresa-repository-ului>
cd firecheck
npm ci
cp .env.example .env        # Windows: copy .env.example .env
npm run seed                # creează baza de date cu 40 de inspecții
npm run dev
```

Deschideți http://localhost:5173. `npm run dev` pornește trei procese: serverul (port 3000),
interfața (port 5173) și simulatorul Registrului PSI (port 4000).

**Conturi din seed:** `coord` / `coord123` (coordonator), `inspector1`…`inspector3` / `insp123`.

| Comandă | Ce face |
|---|---|
| `npm run seed` | recreează baza de date cu date sintetice (1 coordonator, 3 inspectori, 2 șabloane, 40 de inspecții) |
| `npm run seed -- --inspections 5000 --inspectors 50` | volumul pentru testul de încărcare |
| `npm run dev` | server + interfață + simulator, cu reîncărcare automată |
| `npm test` | toate testele automate (unitate, integrare, pachetul EXT) |
| `npm run coverage` | testele + raportul de coverage (praguri: 70% statements, 60% branches) |
| `npm run test:e2e` | construiește aplicația și rulează testele Playwright (fluxul complet + pachetul OFF); prima dată: `npx playwright install chromium` |
| `npm run test:off-10min` | testul cu 10 minute offline; dovada în `docs/evidence/off-10min.md` |
| `npm run load` | testul de încărcare pe 3 niveluri (~4 minute); rezultatele în `docs/evidence/load-results.md` |
| `npm run load:fara-indexuri` | același test, cu indexurile șterse (experimentul de comparație); rezultatele în `docs/evidence/load-results-fara-indexuri.md` |
| `npm run demo:ext` | demonstrația pachetului EXT: o trimitere cu timeout, 429, 503 și răspuns pierdut |
| `npm run registry` | doar simulatorul Registrului PSI |
| `npm run build` | construiește interfața pentru producție |
| `npm start` | aplicația în mod producție, http://localhost:3000 (după `npm run build`; simulatorul se pornește separat cu `npm run registry`) |

**Funcționarea offline** (service worker-ul) e activă doar în build-ul de producție:
`npm run build`, `npm run registry` într-un terminal și `npm start` în altul, apoi
http://localhost:3000. Pașii pentru prezentare: [docs/demo.md](docs/demo.md).

## Documentație

| Document | Conținut |
|---|---|
| [docs/requirements.md](docs/requirements.md) | roluri, permisiuni, fluxuri cu criterii de acceptare, fluxul cu stări, reguli și invariante, trasabilitate față de enunț |
| [docs/architecture.md](docs/architecture.md) | arhitectură, tehnologii, modelul de date, API, sincronizare, integrarea externă, securitate |
| [docs/openapi.json](docs/openapi.json) | descrierea formală a API-ului (OpenAPI 3.1) |
| [docs/packages/OFF.md](docs/packages/OFF.md) | pachetul OFF: cerințe, soluție, verificări, limite |
| [docs/packages/EXT.md](docs/packages/EXT.md) | pachetul EXT: contractul Registrului PSI, soluție, verificări, limite |
| [docs/adr/](docs/adr/) | deciziile arhitecturale (câte una per pachet) |
| [docs/testing.md](docs/testing.md) | plan de teste, coverage și excluderi, lacune |
| [docs/capacity.md](docs/capacity.md) | model de sarcină, obiective, niveluri de încărcare, estimarea capacității |
| [docs/ai-usage.md](docs/ai-usage.md) | utilizarea AI, cazuri tehnice, contribuții individuale |
| [docs/demo.md](docs/demo.md) | pașii demonstrației finale |
| [docs/evidence/](docs/evidence/) | dovezi: teste OFF și EXT, coverage, încărcare, capturi de ecran |

## Structura proiectului

```
server/        API Express: rute, reguli de business, modele Sequelize, integrarea cu Registrul
registry-sim/  simulatorul serviciului extern Registrul PSI
client/        interfața React (Vite), cu modulul de sincronizare offline în src/lib/
tests/         teste automate (node:test): unit/, api/, ext/, client/
e2e/           teste Playwright (fluxul complet și pachetul OFF)
load/          testul de încărcare (Artillery)
scripts/       demonstrații
docs/          documentație
```
