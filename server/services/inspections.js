import { randomUUID } from 'node:crypto';
import { checkAnswers, checkPhotos } from '../domain/answers.js';
import { isTooFarInFuture, shouldApply } from '../domain/conflict.js';
import { inspectionDto } from '../domain/dto.js';
import { canTransition, isLockedForInspector } from '../domain/stateMachine.js';
import { HttpError } from '../middleware/errors.js';

const invalid = (details) => new HttpError(400, 'VALIDATION_ERROR', 'Date invalide', details);
const notFound = () => new HttpError(404, 'NOT_FOUND', 'Inspecția nu există');

export function createInspectionService(db, registryProcessor) {
  const { Inspection, Template, User, RegistrySubmission } = db.models;
  const fullInclude = [{ model: User, as: 'inspector', attributes: ['fullName'] }, RegistrySubmission];

  const load = (id, transaction) => Inspection.findByPk(id, { include: fullInclude, transaction });

  async function findTemplate(templateId, transaction) {
    const template = await Template.findByPk(templateId, { transaction });
    if (!template) throw invalid([{ path: 'templateId', message: 'Șablonul nu există' }]);
    return template;
  }

  function checkContent(template, body) {
    const problems = [
      ...checkAnswers(template, body.answers, body.status === 'submitted'),
      ...checkPhotos(body.photos)
    ];
    if (problems.length) throw invalid(problems);
  }

  // Asignare: coordonatorul creează o inspecție goală pentru un inspector.
  async function assign(coordinator, body) {
    const id = randomUUID();
    await db.write(async (transaction) => {
      await findTemplate(body.templateId, transaction);
      const inspector = await User.findByPk(body.inspectorId, { transaction });
      if (inspector?.role !== 'inspector') {
        throw invalid([{ path: 'inspectorId', message: 'Inspectorul nu există' }]);
      }
      await Inspection.create({
        id,
        templateId: body.templateId,
        inspectorId: body.inspectorId,
        location: body.location,
        dueDate: body.dueDate ?? null,
        status: 'assigned',
        // Încă nemodificată de inspector. Orice modificare a lui e „mai nouă”, chiar dacă ceasul
        // telefonului e în urma serverului (altfel R2 i-ar ignora prima editare).
        clientUpdatedAt: new Date(0)
      }, { transaction });
    });
    return inspectionDto(await load(id));
  }

  // PUT /api/inspections/{id}: creare sau actualizare idempotentă (docs/architecture.md, secțiunea 5).
  async function upsert(inspector, id, body, now = new Date()) {
    if (isTooFarInFuture(body.clientUpdatedAt, now)) {
      throw invalid([{ path: 'clientUpdatedAt', message: 'Data e în viitor; verifică ceasul dispozitivului' }]);
    }

    const result = await db.write(async (transaction) => {
      const existing = await Inspection.findByPk(id, { transaction });

      // R4: inspecția altcuiva se comportă ca și cum n-ar exista.
      if (existing && existing.inspectorId !== inspector.id) throw notFound();

      if (!existing) {
        const template = await findTemplate(body.templateId, transaction);
        if (!canTransition(null, body.status, 'inspector')) throw invalid([{ path: 'status', message: 'Status inițial nepermis' }]);
        checkContent(template, body);
        await Inspection.create({ id, inspectorId: inspector.id, ...body }, { transaction });
        return { status: 201, applied: true };
      }

      if (existing.templateId !== body.templateId) {
        throw invalid([{ path: 'templateId', message: 'Șablonul unei inspecții nu se poate schimba' }]);
      }

      // R1 + R2: o cerere duplicată sau mai veche nu schimbă nimic.
      if (!shouldApply(body.clientUpdatedAt, existing.clientUpdatedAt)) {
        return { status: 200, applied: false };
      }

      // R3: inspecție în revizie sau aprobată → conflict; clientul preia starea serverului.
      if (isLockedForInspector(existing.status)) return { status: 409 };

      if (!canTransition(existing.status, body.status, 'inspector')) {
        throw invalid([{ path: 'status', message: `Tranziție nepermisă: ${existing.status} → ${body.status}` }]);
      }
      checkContent(await findTemplate(existing.templateId, transaction), body);
      await existing.update(body, { transaction });
      return { status: 200, applied: true };
    });

    const inspection = inspectionDto(await load(id));
    if (result.status === 409) {
      throw new HttpError(409, 'INSPECTION_LOCKED', 'Inspecția e în revizie sau aprobată și nu mai poate fi modificată', undefined, { inspection });
    }
    return { status: result.status, body: { applied: result.applied, inspection } };
  }

  // Revizie: aprobare sau returnare, doar din `submitted`.
  async function review(id, { decision, comment }) {
    await db.write(async (transaction) => {
      const inspection = await Inspection.findByPk(id, { transaction });
      if (!inspection) throw notFound();
      const target = decision === 'approve' ? 'approved' : 'returned';
      if (!canTransition(inspection.status, target, 'coordinator')) {
        throw new HttpError(409, 'INVALID_TRANSITION', `Inspecția are statusul „${inspection.status}” și nu poate fi revizuită`);
      }
      await inspection.update({ status: target, reviewComment: comment ?? null }, { transaction });
      // R11: aprobarea și crearea trimiterii sunt în aceeași tranzacție.
      if (target === 'approved') {
        await RegistrySubmission.create({ inspectionId: id, status: 'pending' }, { transaction });
      }
    });
    if (decision === 'approve') registryProcessor.process(id);
    return inspectionDto(await load(id));
  }

  // Reîncercare manuală a unei trimiteri eșuate la Registru.
  async function retrySubmission(id) {
    await db.write(async (transaction) => {
      const inspection = await Inspection.findByPk(id, { include: RegistrySubmission, transaction });
      if (!inspection) throw notFound();
      const submission = inspection.RegistrySubmission;
      if (submission?.status !== 'failed') {
        throw new HttpError(409, 'INVALID_TRANSITION', 'Doar o trimitere eșuată poate fi reîncercată');
      }
      await submission.update({ status: 'pending', attempts: 0, lastError: null, nextAttemptAt: null }, { transaction });
    });
    registryProcessor.process(id);
    return inspectionDto(await load(id)).registry;
  }

  return { assign, upsert, review, retrySubmission, load };
}
