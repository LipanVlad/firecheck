// Cereri HTTP către API, cu timeout și reîncercări limitate (Cursul 03, #23–24; regula R12).
//
// - timeout 5 s pe încercare (AbortController);
// - se reîncearcă doar erorile de rețea, timeout-urile și răspunsurile 5xx;
// - maximum 3 încercări, cu pauze de 500 ms și 1000 ms;
// - 4xx nu se reîncearcă: o cerere identică ar primi același răspuns.
//
// Reîncercarea unui PUT e sigură pentru că serverul îl tratează idempotent (R1).
// Rezultat: { status, body, serverTime, headersAfterMs, startedAfterMs } sau NetworkError dacă toate
// încercările au eșuat. serverTime = ora serverului din antetul Date (în ms); headersAfterMs = cât a
// durat încercarea reușită până au sosit antetele (nu și corpul); startedAfterMs = după cât timp de
// la apel a pornit acea încercare (încercările eșuate și pauzele de dinainte). Împreună permit
// corecția ceasului fără să confundăm o descărcare lentă sau o reîncercare cu un ceas greșit.

export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createRequest({
  baseUrl = '',
  fetchFn = (...args) => fetch(...args),
  sleep = defaultSleep,
  timeoutMs = 5000,
  delaysMs = [500, 1000]
} = {}) {
  async function attempt(method, path, { token, body }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const started = Date.now();
      const response = await fetchFn(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(token && { Authorization: `Bearer ${token}` })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      // fetch se rezolvă când sosesc antetele; corpul se descarcă abia la response.text().
      const headersAfterMs = Date.now() - started;
      const text = await response.text();
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      const serverTime = Date.parse(response.headers?.get?.('date') ?? '') || null;
      return { status: response.status, body: parsed, serverTime, headersAfterMs };
    } catch (error) {
      throw new NetworkError(controller.signal.aborted ? `Serverul nu a răspuns în ${timeoutMs / 1000} s` : 'Fără conexiune la server');
    } finally {
      clearTimeout(timer);
    }
  }

  return async function request(method, path, options = {}) {
    const begin = Date.now();
    let lastError;
    for (let i = 0; i <= delaysMs.length; i += 1) {
      try {
        const attemptStart = Date.now();
        const result = await attempt(method, path, options);
        // startedAfterMs = când a pornit încercarea reușită, față de apelul request(). Încercările
        // eșuate și pauzele dintre ele nu trebuie socotite în corecția ceasului.
        if (result.status < 500) return { ...result, startedAfterMs: attemptStart - begin };
        lastError = new NetworkError(`Eroare de server (${result.status})`);
      } catch (error) {
        lastError = error;
      }
      if (i < delaysMs.length) await sleep(delaysMs[i]);
    }
    throw lastError;
  };
}
