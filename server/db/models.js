// Modelul de date (vezi docs/architecture.md, secțiunea „Modelul de date”).
// Constrângerile importante sunt puse în baza de date, nu doar în cod:
// chei primare, chei străine, UNIQUE, NOT NULL și CHECK pentru valorile permise.

import { DataTypes } from 'sequelize';

export const ROLES = ['coordinator', 'inspector'];
export const INSPECTION_STATUSES = ['assigned', 'in_progress', 'submitted', 'returned', 'approved'];
export const SUBMISSION_STATUSES = ['pending', 'sending', 'sent', 'failed'];

// SQLite nu are tip ENUM; folosim TEXT + CHECK, ca valoarea să fie verificată de baza de date.
const textIn = (column, values) => ({
  type: `TEXT CHECK (${column} IN (${values.map((v) => `'${v}'`).join(', ')}))`,
  allowNull: false,
  validate: { isIn: [values] }
});

export function defineModels(sequelize) {
  const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false, field: 'password_hash' },
    fullName: { type: DataTypes.STRING(100), allowNull: false, field: 'full_name' },
    role: textIn('role', ROLES)
  }, { tableName: 'users', underscored: true });

  const Session = sequelize.define('Session', {
    // Se păstrează doar hash-ul tokenului, nu tokenul în clar.
    tokenHash: { type: DataTypes.STRING(64), primaryKey: true, field: 'token_hash' },
    expiresAt: { type: DataTypes.DATE, allowNull: false, field: 'expires_at' }
  }, { tableName: 'sessions', underscored: true, updatedAt: false });

  const Template = sequelize.define('Template', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING(100), allowNull: false },
    // JSON: [{ "id": "q1", "text": "..." }]
    questions: { type: DataTypes.JSON, allowNull: false }
  }, { tableName: 'templates', underscored: true, updatedAt: false });

  const Inspection = sequelize.define('Inspection', {
    // UUID generat de client (inspecții neplanificate) sau de server (asignări).
    // Cheia primară împiedică la nivel de bază de date două rânduri pentru aceeași inspecție.
    id: { type: DataTypes.UUID, primaryKey: true },
    location: { type: DataTypes.STRING(200), allowNull: false },
    dueDate: { type: DataTypes.DATEONLY, field: 'due_date' },
    status: textIn('status', INSPECTION_STATUSES),
    // JSON: { "q1": { "value": "pass", "note": "" } }
    answers: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    // JSON: [ "data:image/jpeg;base64,..." ]
    photos: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    reviewComment: { type: DataTypes.STRING(500), field: 'review_comment' },
    // Momentul ultimei modificări făcute de inspector, pe dispozitivul lui (regula de conflict).
    clientUpdatedAt: { type: DataTypes.DATE, allowNull: false, field: 'client_updated_at' }
  }, {
    tableName: 'inspections',
    underscored: true,
    // Fără aceste indexuri, fiecare listare citește tot tabelul, inclusiv pozele
    // (găsit la testul de încărcare; vezi docs/evidence/load-results.md).
    indexes: [
      { name: 'idx_inspections_inspector_updated', fields: ['inspector_id', 'updated_at'] },
      { name: 'idx_inspections_status', fields: ['status'] },
      { name: 'idx_inspections_due_date', fields: ['due_date'] }
    ]
  });

  // Trimiterea unei inspecții aprobate la serviciul extern „Registrul PSI” (pachetul EXT).
  const RegistrySubmission = sequelize.define('RegistrySubmission', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    // UNIQUE: o inspecție are cel mult o trimitere, deci cel mult o chitanță.
    inspectionId: { type: DataTypes.UUID, allowNull: false, unique: true, field: 'inspection_id' },
    status: textIn('status', SUBMISSION_STATUSES),
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    lastError: { type: DataTypes.STRING(300), field: 'last_error' },
    nextAttemptAt: { type: DataTypes.DATE, field: 'next_attempt_at' },
    receiptNo: { type: DataTypes.STRING(50), field: 'receipt_no' }
  }, { tableName: 'registry_submissions', underscored: true });

  const fk = (name) => ({ foreignKey: { name, allowNull: false }, onDelete: 'RESTRICT' });

  User.hasMany(Session, fk('userId'));
  Session.belongsTo(User, fk('userId'));

  User.hasMany(Template, fk('createdBy'));
  Template.belongsTo(User, { ...fk('createdBy'), as: 'author' });

  Template.hasMany(Inspection, fk('templateId'));
  Inspection.belongsTo(Template, fk('templateId'));

  User.hasMany(Inspection, { ...fk('inspectorId'), as: 'inspections' });
  Inspection.belongsTo(User, { ...fk('inspectorId'), as: 'inspector' });

  Inspection.hasOne(RegistrySubmission, { foreignKey: { name: 'inspectionId', allowNull: false }, onDelete: 'RESTRICT' });
  RegistrySubmission.belongsTo(Inspection, { foreignKey: { name: 'inspectionId', allowNull: false } });

  return { User, Session, Template, Inspection, RegistrySubmission };
}
