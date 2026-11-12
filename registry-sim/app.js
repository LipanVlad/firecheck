import express from 'express';

// Simulatorul serviciului extern „Registrul PSI” (contractul: docs/packages/EXT.md).
// E o aplicație separată, pe alt port, ca un serviciu real. Prin rutele /_control,
// testele îi spun exact cum să se comporte la următoarele cereri (scenarii deterministe).

export const STEPS = ['ok', 'timeout', 'lost_response', 'error_500', 'error_503', 'rate_limit', 'rate_limit_no_header', 'bad_request'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createRegistrySim({ apiKey, slowMs = 10000, retryAfterSeconds = 1 }) {
  const state = { steps: [], requests: 0, requestsByKey: {}, records: new Map(), sequence: 0 };

  // Înregistrare idempotentă: aceeași cheie → aceeași chitanță, o singură înregistrare.
  function register(key) {
    const existing = state.records.get(key);
    if (existing) return { created: false, record: existing };
    state.sequence += 1;
    const record = { receiptNo: `PSI-2026-${String(state.sequence).padStart(6, '0')}`, registeredAt: new Date().toISOString() };
    state.records.set(key, record);
    return { created: true, record };
  }

  const reply = (response, { created, record }) =>
    response.status(created ? 201 : 200).json({ ...record, duplicate: !created });

  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.post('/_control/scenario', (request, response) => {
    const steps = request.body?.steps;
    if (!Array.isArray(steps) || !steps.every((s) => STEPS.includes(s))) {
      return response.status(400).json({ error: `steps trebuie să conțină doar: ${STEPS.join(', ')}` });
    }
    state.steps = [...steps];
    response.json({ steps: state.steps });
  });

  app.get('/_control/stats', (request, response) => {
    response.json({ requests: state.requests, registrations: state.records.size, requestsByKey: state.requestsByKey, pendingSteps: state.steps });
  });

  app.post('/_control/reset', (request, response) => {
    Object.assign(state, { steps: [], requests: 0, requestsByKey: {}, records: new Map(), sequence: 0 });
    response.status(204).end();
  });

  app.post('/v1/reports', async (request, response) => {
    state.requests += 1;
    const key = request.get('idempotency-key') ?? '';
    state.requestsByKey[key] = (state.requestsByKey[key] ?? 0) + 1;

    if (request.get('authorization') !== `Bearer ${apiKey}`) {
      return response.status(401).json({ error: 'Cheie de acces invalidă' });
    }
    const body = request.body ?? {};
    if (!UUID.test(key) || body.inspectionId !== key || typeof body.location !== 'string') {
      return response.status(400).json({ error: 'Cerere invalidă: Idempotency-Key trebuie să fie ID-ul inspecției' });
    }

    const step = state.steps.shift() ?? 'ok';
    switch (step) {
      case 'error_500':
        return response.status(500).json({ error: 'Eroare internă simulată' });
      case 'error_503':
        return response.status(503).json({ error: 'Serviciu indisponibil (simulat)' });
      case 'rate_limit':
        return response.set('Retry-After', String(retryAfterSeconds)).status(429).json({ error: 'Prea multe cereri' });
      case 'rate_limit_no_header':
        // Unele servicii trimit 429 fără Retry-After: clientul trebuie să folosească backoff-ul.
        return response.status(429).json({ error: 'Prea multe cereri' });
      case 'bad_request':
        return response.status(400).json({ error: 'Cerere respinsă (simulat)' });
      case 'lost_response':
        // Înregistrează, apoi închide conexiunea: clientul nu află că a reușit.
        register(key);
        return request.socket.destroy();
      case 'timeout':
        // Răspunde prea târziu: clientul a renunțat deja, dar înregistrarea are loc.
        await sleep(slowMs);
        return reply(response, register(key));
      default:
        return reply(response, register(key));
    }
  });

  return app;
}
