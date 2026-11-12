import { Router } from 'express';
import Joi from 'joi';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const templateSchema = Joi.object({
  name: Joi.string().trim().min(3).max(100).required(),
  questions: Joi.array().items(Joi.string().trim().min(3).max(200)).min(1).max(30).required()
});

export const templateDto = (t) => ({ id: t.id, name: t.name, questions: t.questions, createdAt: t.createdAt.toISOString() });

// Șabloanele sunt imutabile (R9): există doar listare și creare.
export function templateRoutes(db) {
  const { Template } = db.models;
  const router = Router();

  router.get('/', async (request, response) => {
    const templates = await Template.findAll({ order: [['id', 'ASC']] });
    response.json(templates.map(templateDto));
  });

  router.post('/', requireRole('coordinator'), validate(templateSchema), async (request, response) => {
    const { name, questions } = request.valid.body;
    const template = await db.write((transaction) => Template.create({
      name,
      questions: questions.map((text, index) => ({ id: `q${index + 1}`, text })),
      createdBy: request.user.id
    }, { transaction }));
    response.status(201).json(templateDto(template));
  });

  return router;
}
