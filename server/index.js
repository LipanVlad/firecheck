import { createApp } from './app.js';
import { config } from './config.js';
import { createDatabase } from './db/index.js';

if (!config.registry.apiKey) {
  console.warn('Atenție: lipsește REGISTRY_API_KEY; trimiterile la Registrul PSI vor eșua. Copiați .env.example în .env.');
}

const db = await createDatabase({ storage: config.dbStorage });
const app = createApp({ db, logRequests: config.logRequests, registry: config.registry });

// METRICS=1: scrie la fiecare secundă procesorul și memoria folosite (pentru testul de încărcare).
if (process.env.METRICS === '1') {
  let last = process.cpuUsage();
  let lastTime = performance.now();
  setInterval(() => {
    const usage = process.cpuUsage(last);
    const elapsedMs = performance.now() - lastTime;
    last = process.cpuUsage();
    lastTime = performance.now();
    const cpu = ((usage.user + usage.system) / 1000 / elapsedMs) * 100;
    const { rss, heapUsed } = process.memoryUsage();
    console.log(JSON.stringify({ metrics: true, t: Date.now(), cpu: Number(cpu.toFixed(1)), rssMb: Math.round(rss / 1048576), heapMb: Math.round(heapUsed / 1048576) }));
  }, 1000).unref();
}

app.listen(config.port, () => {
  console.log(`FireCheck API: http://localhost:${config.port}/api/health`);
  // Reia trimiterile la Registru rămase neterminate la oprirea anterioară.
  app.locals.registryProcessor.resume();
});
