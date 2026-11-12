import { Router } from 'express';
import Joi from 'joi';
import { Op } from 'sequelize';
import { inspectionDto } from '../domain/dto.js';
import { INSPECTION_STATUSES } from '../db/models.js';
import { HttpError } from '../middleware/errors.js';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const SORT_COLUMNS = { dueDate: 'due_date', updatedAt: 'updated_at', location: 'location', status: 'status' };

const listSchema = Joi.object({
  status: Joi.string().valid(...INSPECTION_STATUSES),
  inspectorId: Joi.number().integer().min(1),
  q: Joi.string().trim().min(2).max(100),
  dueBefore: Joi.date().iso(),
  sort: Joi.string().valid(...Object.keys(SORT_COLUMNS)).default('updatedAt'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20)
});

const idSchema = Joi.object({ id: Joi.string().guid({ version: 'uuidv4' }).required() });

const assignSchema = Joi.object({
  templateId: Joi.number().integer().min(1).required(),
  inspectorId: Joi.number().integer().min(1).required(),
  location: Joi.string().trim().min(3).max(200).required(),
  dueDate: Joi.date().iso()
});

const answerSchema = Joi.object({
  value: Joi.string().valid('pass', 'fail', 'na').required(),
  note: Joi.string().allow('').max(500).default('')
});

const putSchema = Joi.object({
  templateId: Joi.number().integer().min(1).required(),
  location: Joi.string().trim().min(3).max(200).required(),
  status: Joi.string().valid('in_progress', 'submitted').required(),
  answers: Joi.object().pattern(Joi.string().max(20), answerSchema).required(),
  photos: Joi.array().items(Joi.string().pattern(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/)).max(3).default([]),
  clientUpdatedAt: Joi.date().iso().required()
});

const reviewSchema = Joi.object({
  decision: Joi.string().valid('approve', 'return').required(),
  comment: Joi.string().trim().min(5).max(500).when('decision', { is: 'return', then: Joi.required() })
});

const dateOnly = (date) => date.toISOString().slice(0, 10);

export function inspectionRoutes(db, service) {
  const { sequelize } = db;
  const { Inspection, User } = db.models;
  const router = Router();
  const coordinatorOnly = requireRole('coordinator');

  router.get('/', validate(listSchema, 'query'), async (request, response) => {
    const { status, inspectorId, q, dueBefore, sort, order, page, pageSize } = request.valid.query;
    const where = {};
    // R4: inspectorul vede doar inspecțiile lui, indiferent de parametri.
    if (request.user.role === 'inspector') where.inspectorId = request.user.id;
    else if (inspectorId) where.inspectorId = inspectorId;
    if (status) where.status = status;
    // Căutare de subșir literală. Cu instr() în loc de LIKE, caracterele % și _ din text nu sunt
    // interpretate ca „orice”. lower() se aplică în SQLite pe ambele părți: ignoră diferența dintre
    // litere mari și mici la literele fără diacritice, iar pe cele cu diacritice le compară exact.
    if (q) where[Op.and] = [sequelize.where(sequelize.fn('instr', sequelize.fn('lower', sequelize.col('Inspection.location')), sequelize.fn('lower', q)), Op.gt, 0)];
    if (dueBefore) where.dueDate = { [Op.lte]: dateOnly(dueBefore) };

    const { rows, count } = await Inspection.findAndCountAll({
      where,
      // Pozele nu se trimit în listă, doar numărul lor.
      attributes: { exclude: ['photos'], include: [[sequelize.fn('json_array_length', sequelize.col('Inspection.photos')), 'photoCount']] },
      include: [{ model: User, as: 'inspector', attributes: ['fullName'] }],
      // A doua cheie de sortare (id) face paginarea stabilă când valorile sunt egale.
      order: [[sequelize.col(`Inspection.${SORT_COLUMNS[sort]}`), order.toUpperCase()], ['id', 'ASC']],
      limit: pageSize,
      offset: (page - 1) * pageSize
    });

    response.json({
      items: rows.map((row) => inspectionDto(row, { withPhotos: false })),
      page,
      pageSize,
      total: count,
      totalPages: Math.ceil(count / pageSize)
    });
  });

  router.post('/', coordinatorOnly, validate(assignSchema), async (request, response) => {
    const body = { ...request.valid.body };
    if (body.dueDate) body.dueDate = dateOnly(body.dueDate);
    response.status(201).json(await service.assign(request.user, body));
  });

  router.get('/:id', validate(idSchema, 'params'), async (request, response) => {
    const inspection = await service.load(request.valid.params.id);
    const hidden = request.user.role === 'inspector' && inspection?.inspectorId !== request.user.id;
    if (!inspection || hidden) throw new HttpError(404, 'NOT_FOUND', 'Inspecția nu există');
    response.json(inspectionDto(inspection));
  });

  router.put('/:id', requireRole('inspector'), validate(idSchema, 'params'), validate(putSchema), async (request, response) => {
    const { status, body } = await service.upsert(request.user, request.valid.params.id, request.valid.body);
    response.status(status).json(body);
  });

  router.post('/:id/review', coordinatorOnly, validate(idSchema, 'params'), validate(reviewSchema), async (request, response) => {
    response.json(await service.review(request.valid.params.id, request.valid.body));
  });

  router.post('/:id/registry/retry', coordinatorOnly, validate(idSchema, 'params'), async (request, response) => {
    response.status(202).json(await service.retrySubmission(request.valid.params.id));
  });

  return router;
}
