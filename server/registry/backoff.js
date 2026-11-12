// Pauza dinaintea următoarei încercări (R12).
// - la 429 cu Retry-After: exact cât cere Registrul, dar maximum maxRetryAfterMs;
// - altfel backoff exponențial: base, 2·base, 4·base, 8·base…
export function nextDelayMs({ attempt, baseDelayMs, retryAfterMs, maxRetryAfterMs }) {
  if (retryAfterMs != null) return Math.min(retryAfterMs, maxRetryAfterMs);
  return baseDelayMs * 2 ** (attempt - 1);
}
