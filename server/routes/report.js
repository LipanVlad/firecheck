import { Router } from 'express';
import Joi from 'joi';
import { INSPECTION_STATUSES, SUBMISSION_STATUSES } from '../db/models.js';
import { requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const reportSchema = Joi.object({
  from: Joi.date().iso(),
  // `to` poate fi folosit și singur; dacă există și `from`, nu poate fi înaintea lui.
  to: Joi.date().iso().when('from', { is: Joi.exist(), then: Joi.date().min(Joi.ref('from')) }),
  inspectorId: Joi.number().integer().min(1)
});

const zeros = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));

// Raportul central (F4). Agregările se fac în SQL, nu în memorie. Valorile filtrelor sunt
// parametri legați (`bind`): ajung la SQLite separat de textul interogării, nu inserate în el.
export function reportRoutes(db) {
  const { sequelize } = db;
  const router = Router();

  router.get('/', requireRole('coordinator'), validate(reportSchema, 'query'), async (request, response) => {
    const { from, to, inspectorId } = request.valid.query;

    // Filtrul comun, construit doar din fragmente fixe; valorile merg ca parametri.
    const conditions = [];
    const params = {};
    if (from) { conditions.push('i.updated_at >= $from'); params.from = from.toISOString(); }
    if (to) { conditions.push('i.updated_at < $to'); params.to = new Date(to.getTime() + 86400000).toISOString(); }
    if (inspectorId) { conditions.push('i.inspector_id = $inspectorId'); params.inspectorId = inspectorId; }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = (sql) => sequelize.query(sql, { bind: params, type: 'SELECT' });

    const byStatusRows = await query(`SELECT i.status, COUNT(*) AS n FROM inspections i ${where} GROUP BY i.status`);
    const byInspectorRows = await query(`
      SELECT u.id AS inspectorId, u.full_name AS inspectorName, i.status, COUNT(*) AS n
      FROM inspections i JOIN users u ON u.id = i.inspector_id ${where}
      GROUP BY u.id, u.full_name, i.status ORDER BY u.full_name`);
    const failRows = await query(`
      SELECT i.template_id AS templateId, a.key AS questionId, COUNT(*) AS failCount
      FROM inspections i, json_each(i.answers) a
      ${where ? `${where} AND` : 'WHERE'} json_extract(a.value, '$.value') = 'fail'
      GROUP BY i.template_id, a.key ORDER BY failCount DESC, templateId, questionId LIMIT 10`);
    const registryRows = await query(`
      SELECT s.status, COUNT(*) AS n
      FROM registry_submissions s JOIN inspections i ON i.id = s.inspection_id ${where}
      GROUP BY s.status`);

    const templates = await db.models.Template.findAll({ attributes: ['id', 'questions'] });
    const questionText = new Map(templates.flatMap((t) => t.questions.map((q) => [`${t.id}:${q.id}`, q.text])));

    const byStatus = zeros(INSPECTION_STATUSES);
    for (const row of byStatusRows) byStatus[row.status] = row.n;

    const inspectors = new Map();
    for (const row of byInspectorRows) {
      if (!inspectors.has(row.inspectorId)) {
        inspectors.set(row.inspectorId, { inspectorId: row.inspectorId, inspectorName: row.inspectorName, ...zeros(INSPECTION_STATUSES) });
      }
      inspectors.get(row.inspectorId)[row.status] = row.n;
    }

    const registry = zeros(SUBMISSION_STATUSES);
    for (const row of registryRows) registry[row.status] = row.n;

    response.json({
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
      byInspector: [...inspectors.values()],
      topNonConformities: failRows.map((row) => ({ ...row, questionText: questionText.get(`${row.templateId}:${row.questionId}`) ?? null })),
      registry
    });
  });

  return router;
}
