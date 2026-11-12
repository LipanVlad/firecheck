// Tratarea centralizată a erorilor (Cursul 05, #33–35).
// Clientul primește mereu același format: { error: { code, message, details? } }.
// Detaliile interne (stack trace, mesaje SQL) ajung doar în jurnalul serverului.

export class HttpError extends Error {
  // extra: câmpuri adăugate lângă `error` în corpul răspunsului (de ex. starea inspecției la 409).
  constructor(status, code, message, details, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.extra = extra;
  }
}

export function notFound(request, response, next) {
  next(new HttpError(404, 'NOT_FOUND', 'Resursa nu există'));
}

export function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);

  if (error instanceof HttpError) {
    const body = { code: error.code, message: error.message };
    if (error.details) body.details = error.details;
    return response.status(error.status).json({ error: body, ...error.extra });
  }

  // Erori produse de express.json(): JSON invalid sau corp prea mare.
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Corpul cererii nu este JSON valid' } });
  }
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Corpul cererii este prea mare' } });
  }

  console.error(`[${request.id}]`, error);
  return response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Eroare internă' } });
}
