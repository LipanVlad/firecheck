import { HttpError } from './errors.js';

// Validează request.body, request.query sau request.params cu o schemă Joi (R7).
// Valorile validate (cu conversii și valori implicite) se pun în request.valid[source].
export function validate(schema, source = 'body') {
  return (request, response, next) => {
    const { error, value } = schema.validate(request[source] ?? {}, { abortEarly: false, convert: true });
    if (error) {
      const details = error.details.map((d) => ({ path: d.path.join('.'), message: d.message }));
      throw new HttpError(400, 'VALIDATION_ERROR', 'Date invalide', details);
    }
    request.valid = { ...request.valid, [source]: value };
    next();
  };
}
