import { createHash, randomBytes } from 'node:crypto';

export const SESSION_DAYS = 7;

// Tokenul în clar ajunge doar la client. În baza de date se păstrează doar hash-ul lui,
// deci o copie a bazei de date nu permite autentificarea.
export function createToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionExpiry(now = new Date()) {
  return new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
}
