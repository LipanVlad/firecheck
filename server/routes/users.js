import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { userDto } from './auth.js';

// Lista inspectorilor, pentru formularul de asignare și filtrele coordonatorului.
export function userRoutes(db) {
  const router = Router();
  router.get('/', requireRole('coordinator'), async (request, response) => {
    const users = await db.models.User.findAll({ where: { role: 'inspector' }, order: [['fullName', 'ASC']] });
    response.json(users.map(userDto));
  });
  return router;
}
