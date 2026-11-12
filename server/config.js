// Configurația aplicației, citită din variabile de mediu (vezi .env.example).

// Încarcă .env dacă există (funcție inclusă în Node, fără pachetul dotenv).
try {
  process.loadEnvFile();
} catch {
  // Fără .env se folosesc valorile implicite de mai jos.
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  // ':memory:' pentru teste; fișier pe disc pentru dezvoltare și producție.
  dbStorage: process.env.DB_STORAGE ?? 'data/firecheck.sqlite',
  logRequests: process.env.LOG_REQUESTS !== '0',
  registry: {
    // Adresa serviciului extern „Registrul PSI” (simulatorul local din registry-sim/).
    url: process.env.REGISTRY_URL ?? 'http://localhost:4000',
    // Cheia de acces la Registru. Valoarea reală stă doar în .env, care nu intră în Git.
    apiKey: process.env.REGISTRY_API_KEY ?? ''
  },
  registrySimPort: Number(process.env.REGISTRY_SIM_PORT ?? 4000)
};
