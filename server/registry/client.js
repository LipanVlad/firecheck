// Clientul HTTP pentru Registrul PSI (contractul: docs/packages/EXT.md).
// Nu reîncearcă singur: întoarce un rezultat clasificat, iar procesorul decide ce urmează.
//
// Rezultat: { ok: true, receiptNo, duplicate }
//        sau { ok: false, retryable, error, retryAfterMs? }

// Retry-After poate fi un număr de secunde („120”) sau o dată HTTP. Lipsă sau invalid → null,
// adică backoff exponențial normal (nu zero: Number(null) ar da 0 și reîncercări imediate).
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null || value.trim() === '') return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export function createRegistryClient({ url, apiKey, timeoutMs = 3000 }) {
  async function submit(report, idempotencyKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(`${url}/v1/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(report),
        signal: controller.signal
      });
      // Corpul se citește tot sub timeout: un răspuns care se oprește la jumătate e tot un eșec temporar.
      const body = response.status === 200 || response.status === 201 ? await response.json() : null;
      if (body) return { ok: true, receiptNo: body.receiptNo, duplicate: Boolean(body.duplicate) };
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, retryable: true, error: `timeout după ${timeoutMs} ms` };
      return { ok: false, retryable: true, error: `eroare de rețea: ${error.cause?.code ?? error.message}` };
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429) {
      return { ok: false, retryable: true, error: '429 limitare de trafic', retryAfterMs: parseRetryAfter(response.headers.get('retry-after')) };
    }
    if (response.status >= 500) return { ok: false, retryable: true, error: `eroare ${response.status} la Registru` };
    // 400, 401 și alte 4xx: o reîncercare identică ar eșua la fel.
    return { ok: false, retryable: false, error: `răspuns ${response.status} de la Registru` };
  }

  return { submit };
}
