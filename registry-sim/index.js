import { config } from '../server/config.js';
import { createRegistrySim } from './app.js';

// Pornește simulatorul Registrului PSI ca proces separat (npm run registry).
if (!config.registry.apiKey) {
  console.error('Lipsește REGISTRY_API_KEY. Copiați .env.example în .env.');
  process.exit(1);
}

createRegistrySim({ apiKey: config.registry.apiKey }).listen(config.registrySimPort, () => {
  console.log(`Registrul PSI (simulator): http://localhost:${config.registrySimPort}`);
});
