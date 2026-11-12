import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createDatabase } from '../../server/db/index.js';

// Verifică faptul că invariantele importante sunt protejate de baza de date,
// chiar dacă cineva ocolește validarea din cod.

let db;
let ids;

before(async () => {
  db = await createDatabase({ storage: ':memory:' });
  const { User, Template } = db.models;
  const coord = await User.create({ username: 'coord', passwordHash: 'x', fullName: 'Coordonator', role: 'coordinator' });
  const insp = await User.create({ username: 'insp', passwordHash: 'x', fullName: 'Inspector', role: 'inspector' });
  const tpl = await Template.create({ name: 'Stingătoare', questions: [{ id: 'q1', text: 'Sigiliu intact?' }], createdBy: coord.id });
  ids = { coord: coord.id, insp: insp.id, tpl: tpl.id };
});

after(async () => { await db.sequelize.close(); });

const inspection = (overrides = {}) => ({
  id: randomUUID(),
  templateId: ids.tpl,
  inspectorId: ids.insp,
  location: 'Bloc A, parcare -2',
  status: 'assigned',
  clientUpdatedAt: new Date(),
  ...overrides
});

const rawInsert = (status) => db.sequelize.query(
  `INSERT INTO inspections (id, template_id, inspector_id, location, status, answers, photos, client_updated_at, created_at, updated_at)
   VALUES (?, ?, ?, 'X', ?, '{}', '[]', datetime('now'), datetime('now'), datetime('now'))`,
  { replacements: [randomUUID(), ids.tpl, ids.insp, status] }
);

test('aceeași inspecție (același UUID) nu poate fi inserată de două ori', async () => {
  const data = inspection();
  await db.models.Inspection.create(data);
  await assert.rejects(db.models.Inspection.create(data), { name: 'SequelizeUniqueConstraintError' });
  assert.equal(await db.models.Inspection.count({ where: { id: data.id } }), 1);
});

test('baza de date respinge un status inexistent, chiar ocolind validarea din cod', async () => {
  // Sequelize împachetează eroarea SQLite; mesajul original e în error.original.
  await assert.rejects(rawInsert('deleted'), (error) => /CHECK constraint failed/.test(error.original?.message));
});

test('baza de date acceptă toate cele 5 statusuri definite', async () => {
  for (const status of ['assigned', 'in_progress', 'submitted', 'returned', 'approved']) {
    await rawInsert(status);
  }
});

test('o inspecție nu poate referi un inspector inexistent (cheie străină)', async () => {
  await assert.rejects(db.models.Inspection.create(inspection({ inspectorId: 9999 })), { name: 'SequelizeForeignKeyConstraintError' });
});

test('o inspecție are cel mult o trimitere la Registrul PSI', async () => {
  const insp = await db.models.Inspection.create(inspection({ status: 'approved' }));
  await db.models.RegistrySubmission.create({ inspectionId: insp.id, status: 'pending' });
  await assert.rejects(
    db.models.RegistrySubmission.create({ inspectionId: insp.id, status: 'pending' }),
    { name: 'SequelizeUniqueConstraintError' }
  );
});
