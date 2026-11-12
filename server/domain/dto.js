// Forma în care inspecțiile și trimiterile ies din API (aceeași în listă, detalii și PUT).

const iso = (value) => (value ? new Date(value).toISOString() : null);

export function submissionDto(submission) {
  if (!submission) return null;
  return {
    status: submission.status,
    attempts: submission.attempts,
    lastError: submission.lastError ?? null,
    nextAttemptAt: iso(submission.nextAttemptAt),
    receiptNo: submission.receiptNo ?? null
  };
}

export function inspectionDto(inspection, { withPhotos = true } = {}) {
  const dto = {
    id: inspection.id,
    templateId: inspection.templateId,
    inspectorId: inspection.inspectorId,
    inspectorName: inspection.inspector?.fullName,
    location: inspection.location,
    dueDate: inspection.dueDate ?? null,
    status: inspection.status,
    answers: inspection.answers,
    reviewComment: inspection.reviewComment ?? null,
    photoCount: inspection.get('photoCount') ?? inspection.photos?.length ?? 0,
    clientUpdatedAt: iso(inspection.clientUpdatedAt),
    updatedAt: iso(inspection.updatedAt)
  };
  if (withPhotos) {
    dto.photos = inspection.photos;
    dto.registry = submissionDto(inspection.RegistrySubmission);
  }
  return dto;
}
