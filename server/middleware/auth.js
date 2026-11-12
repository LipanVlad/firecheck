import { HttpError } from './errors.js';
import { hashToken } from '../security/tokens.js';

const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', 'Autentificare necesară');

// Verifică antetul Authorization: Bearer <token> și atașează utilizatorul la cerere.
export function authenticate(db) {
  const { Session, User } = db.models;
  return async (request, response, next) => {
    const match = /^Bearer (\S+)$/.exec(request.get('authorization') ?? '');
    if (!match) throw unauthenticated();

    const session = await Session.findByPk(hashToken(match[1]), { include: User });
    if (!session || session.expiresAt <= new Date()) throw unauthenticated();

    request.user = session.User;
    request.tokenHash = session.tokenHash;
    next();
  };
}

// Permite cererea doar utilizatorilor cu unul din rolurile date (R5).
export function requireRole(...roles) {
  return (request, response, next) => {
    if (!roles.includes(request.user.role)) {
      throw new HttpError(403, 'FORBIDDEN', 'Rolul tău nu permite această operație');
    }
    next();
  };
}
