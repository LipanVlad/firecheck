// Serverul pentru testele Playwright: aplicația în mod producție (servește client/dist),
// o bază de date nouă în memorie cu seed și simulatorul Registrului PSI. Pornit automat de
// playwright.config.js; la fiecare rulare datele sunt aceleași.

import { createRegistrySim } from '../registry-sim/app.js';
import { createApp } from '../server/app.js';
import { createDatabase } from '../server/db/index.js';
import { seedDatabase } from '../server/seed.js';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const SIM_PORT = Number(process.env.E2E_SIM_PORT ?? 4100);
const KEY = 'cheie-e2e';

const db = await createDatabase({ storage: ':memory:' });
await seedDatabase(db);

createRegistrySim({ apiKey: KEY }).listen(SIM_PORT);
const app = createApp({ db, registry: { url: `http://localhost:${SIM_PORT}`, apiKey: KEY, log: () => {} } });
app.listen(PORT, () => console.log(`Server E2E: http://localhost:${PORT}`));
