import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

// Formatul salvat în baza de date: scrypt$<sare hex>$<hash hex>.
// Sarea e aleatorie pentru fiecare parolă, deci aceeași parolă dă hash-uri diferite.
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [algorithm, saltHex, hashHex] = String(stored).split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  // Comparație în timp constant, ca durata să nu dezvăluie cât din hash se potrivește.
  return timingSafeEqual(actual, expected);
}
