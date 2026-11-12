import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { authenticate as authenticateWith } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { createRegistryClient } from './registry/client.js';
import { createRegistryProcessor } from './registry/processor.js';
import { authRoutes, userDto } from './routes/auth.js';
import { inspectionRoutes } from './routes/inspections.js';
import { reportRoutes } from './routes/report.js';
import { templateRoutes } from './routes/templates.js';
import { userRoutes } from './routes/users.js';
import { createInspectionService } from './services/inspections.js';

const clientDist = fileURLToPath(new URL('../client/dist', import.meta.url));

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'"
].join('; ');

// Procesor care nu trimite nimic: pentru testele care nu privesc Registrul PSI.
const disabledProcessor = { process: async () => {}, resume: async () => {}, idle: async () => {}, stop: async () => {} };

// createApp() construiește aplicația fără să o pornească (Cursul 05, #38):
// testele o pot porni pe un port liber, iar server/index.js pe portul configurat.
//
// registry: { url, apiKey, timeoutMs, maxAttempts, baseDelayMs, maxRetryAfterMs, sleep } sau null.
export function createApp({ db, logRequests = false, registry = null }) {
  const app = express();
  app.disable('x-powered-by');

  const processor = registry
    ? createRegistryProcessor({ db, client: createRegistryClient(registry), ...registry, log: registry.log })
    : disabledProcessor;
  app.locals.registryProcessor = processor;
  const service = createInspectionService(db, processor);
  const authenticate = authenticateWith(db);

  app.use((request, response, next) => {
    // ID de cerere în antet și în jurnal, ca o eroare raportată să poată fi găsită (Cursul 05, #36–37).
    request.id = randomUUID();
    response.setHeader('X-Request-Id', request.id);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    // CSP: pagina poate încărca scripturi, stiluri și conexiuni doar de pe propria origine;
    // pozele vin ca data: URL; nicio încadrare în alte site-uri.
    response.setHeader('Content-Security-Policy', CSP);
    if (logRequests) {
      const start = performance.now();
      response.on('finish', () => {
        // Se jurnalizează doar metoda, calea, statusul și durata: fără corp, tokenuri sau parole.
        const ms = Number((performance.now() - start).toFixed(1));
        console.log(JSON.stringify({ id: request.id, method: request.method, path: request.path, status: response.statusCode, ms }));
      });
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', async (request, response) => {
    await db.sequelize.authenticate();
    response.json({ status: 'ok', db: 'ok' });
  });

  app.use('/api/auth', authRoutes(db, authenticate));
  app.get('/api/me', authenticate, (request, response) => response.json(userDto(request.user)));
  app.use('/api/templates', authenticate, templateRoutes(db));
  app.use('/api/inspections', authenticate, inspectionRoutes(db, service));
  app.use('/api/report', authenticate, reportRoutes(db));
  app.use('/api/users', authenticate, userRoutes(db));

  app.use('/api', notFound);

  // În producție (după `npm run build`), același server livrează și aplicația React.
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*path}', (request, response) => response.sendFile('index.html', { root: clientDist }));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
