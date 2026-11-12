import { Router } from 'express';
import Joi from 'joi';
import { HttpError } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';
import { hashPassword, verifyPassword } from '../security/passwords.js';
import { createToken, hashToken, sessionExpiry } from '../security/tokens.js';

const loginSchema = Joi.object({
  username: Joi.string().min(1).max(50).required(),
  password: Joi.string().min(1).max(100).required()
});

// Limită de încercări, în ferestre de 15 minute:
// - 10 autentificări eșuate pentru același cont, de la aceeași adresă (ghicirea unei parole);
// - 50 de autentificări eșuate de la aceeași adresă, pe orice conturi (încercări pe multe conturi).
// Peste limită → 429 până expiră fereastra. Un login reușit resetează contorul contului.
// Contoarele sunt în memorie (o singură instanță de server); cele expirate se șterg periodic.
export const LOGIN_LIMIT = { maxFailures: 10, maxFailuresPerIp: 50, windowMs: 15 * 60 * 1000, maxEntries: 10_000 };

// Hash fals, verificat când utilizatorul nu există, ca răspunsul să dureze cât pentru o parolă
// greșită. Altfel, timpul de răspuns ar dezvălui ce conturi există.
let dummyHash;
const getDummyHash = async () => (dummyHash ??= await hashPassword('parola-inexistenta'));

export const userDto = (user) => ({ id: user.id, username: user.username, fullName: user.fullName, role: user.role });

export function authRoutes(db, authenticate) {
  const { User, Session } = db.models;
  const router = Router();

  const failures = new Map();

  const active = (key, now) => {
    const record = failures.get(key);
    if (record && now - record.since > LOGIN_LIMIT.windowMs) {
      failures.delete(key);
      return null;
    }
    return record ?? null;
  };
  const recordFailure = (key, now) => {
    const current = active(key, now);
    failures.set(key, { since: current?.since ?? now, count: (current?.count ?? 0) + 1 });
  };
  // Memoria nu crește fără limită: la prea multe intrări se șterg cele expirate, apoi cele mai vechi.
  const prune = (now) => {
    if (failures.size <= LOGIN_LIMIT.maxEntries) return;
    for (const [key, record] of failures) if (now - record.since > LOGIN_LIMIT.windowMs) failures.delete(key);
    for (const key of failures.keys()) {
      if (failures.size <= LOGIN_LIMIT.maxEntries) break;
      failures.delete(key);
    }
  };

  router.post('/login', validate(loginSchema), async (request, response) => {
    const { username, password } = request.valid.body;
    const accountKey = `cont|${request.ip}|${username.toLowerCase()}`;
    const ipKey = `ip|${request.ip}`;
    const now = Date.now();
    const blocked = [[accountKey, LOGIN_LIMIT.maxFailures], [ipKey, LOGIN_LIMIT.maxFailuresPerIp]]
      .map(([key, max]) => ({ record: active(key, now), max }))
      .find(({ record, max }) => record && record.count >= max);
    if (blocked) {
      const seconds = Math.ceil((blocked.record.since + LOGIN_LIMIT.windowMs - now) / 1000);
      response.set('Retry-After', String(seconds));
      throw new HttpError(429, 'RATE_LIMITED', `Prea multe încercări eșuate. Încearcă din nou peste ${Math.ceil(seconds / 60)} minute.`);
    }

    const user = await User.findOne({ where: { username } });
    const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
    // Același mesaj pentru utilizator inexistent și parolă greșită: nu dezvăluim ce conturi există.
    if (!user || !valid) {
      recordFailure(accountKey, now);
      recordFailure(ipKey, now);
      prune(now);
      throw new HttpError(401, 'UNAUTHENTICATED', 'Username sau parolă incorecte');
    }
    failures.delete(accountKey);
    const token = createToken();
    await db.write((transaction) =>
      Session.create({ tokenHash: hashToken(token), userId: user.id, expiresAt: sessionExpiry() }, { transaction })
    );
    response.json({ token, user: userDto(user) });
  });

  router.post('/logout', authenticate, async (request, response) => {
    await db.write((transaction) => Session.destroy({ where: { tokenHash: request.tokenHash }, transaction }));
    response.status(204).end();
  });

  return router;
}
