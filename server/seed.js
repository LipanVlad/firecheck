import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './security/passwords.js';

// Date sintetice, deterministe: aceleași argumente produc mereu aceleași date
// (în afară de ID-uri și hash-uri, care sunt aleatorii prin natura lor).

export const SEED_PASSWORDS = { coordinator: 'coord123', inspector: 'insp123' };

export const SEED_TEMPLATES = [
  {
    name: 'Stingătoare și hidranți',
    questions: [
      'Stingătorul e la locul marcat și accesibil?',
      'Stingătorul e în termen de valabilitate?',
      'Sigiliul și manometrul sunt în regulă?',
      'Hidrantul interior are furtunul complet și neîncâlcit?',
      'Cutia hidrantului se deschide fără efort?',
      'Există indicatoare vizibile pentru stingătoare și hidranți?'
    ]
  },
  {
    name: 'Căi de evacuare',
    questions: [
      'Căile de evacuare sunt libere de obstacole?',
      'Ușile de evacuare se deschid în sensul evacuării?',
      'Iluminatul de siguranță funcționează?',
      'Indicatoarele de ieșire sunt iluminate și vizibile?',
      'Planul de evacuare e afișat la fiecare etaj?'
    ]
  }
];

const FIRST = ['Andrei', 'Maria', 'Ion', 'Elena', 'Mihai', 'Ioana', 'Radu', 'Ana', 'Cristian', 'Diana'];
const LAST = ['Popescu', 'Ionescu', 'Dumitrescu', 'Stan', 'Constantin', 'Georgescu', 'Marin', 'Tudor', 'Dinu', 'Ilie'];
const BUILDINGS = ['Bloc A', 'Bloc B', 'Bloc C', 'Mall Vitan', 'Spitalul Județean', 'Școala nr. 12', 'Hotel Central', 'Depozit Logistic', 'Sediu Primărie', 'Parcare Unirii'];
const SPOTS = ['parcare -2', 'subsol tehnic', 'casa scării', 'etaj 3', 'hol principal', 'camera centralei', 'acoperiș', 'parter'];

// Generator pseudo-aleator cu sămânță fixă (mulberry32): rezultate reproductibile.
function random(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Distribuția statusurilor se repetă ciclic. La 40 de inspecții: 8 assigned, 12 in_progress,
// 8 submitted, 4 returned, 8 approved.
const STATUS_CYCLE = ['assigned', 'in_progress', 'submitted', 'approved', 'assigned', 'in_progress', 'returned', 'submitted', 'approved', 'in_progress'];

export async function seedDatabase(db, { inspectors = 3, inspections = 40, seed = 42 } = {}) {
  const { User, Template, Inspection, RegistrySubmission } = db.models;
  const rand = random(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];

  return db.write(async (transaction) => {
    const coordinator = await User.create({
      username: 'coord', passwordHash: await hashPassword(SEED_PASSWORDS.coordinator), fullName: 'Coordonator PSI', role: 'coordinator'
    }, { transaction });

    const inspectorUsers = [];
    for (let i = 1; i <= inspectors; i += 1) {
      inspectorUsers.push(await User.create({
        username: `inspector${i}`,
        passwordHash: await hashPassword(SEED_PASSWORDS.inspector),
        fullName: `${FIRST[(i - 1) % FIRST.length]} ${LAST[Math.floor((i - 1) / FIRST.length) % LAST.length]}`,
        role: 'inspector'
      }, { transaction }));
    }

    const templates = [];
    for (const t of SEED_TEMPLATES) {
      templates.push(await Template.create({
        name: t.name, questions: t.questions.map((text, i) => ({ id: `q${i + 1}`, text })), createdBy: coordinator.id
      }, { transaction }));
    }

    const base = Date.UTC(2026, 10, 2, 8, 0, 0);
    const rows = [];
    const submissions = [];
    for (let n = 0; n < inspections; n += 1) {
      const status = STATUS_CYCLE[n % STATUS_CYCLE.length];
      const template = templates[n % templates.length];
      const answered = { assigned: 0, in_progress: Math.ceil(template.questions.length / 2) }[status] ?? template.questions.length;
      const answers = {};
      for (const q of template.questions.slice(0, answered)) {
        const r = rand();
        const value = r < 0.75 ? 'pass' : r < 0.9 ? 'fail' : 'na';
        answers[q.id] = { value, note: value === 'fail' ? 'Neconformitate constatată la fața locului' : '' };
      }
      const id = randomUUID();
      rows.push({
        id,
        templateId: template.id,
        // Decalajul la fiecare ciclu de statusuri: altfel, când numărul de inspectori împarte
        // lungimea ciclului (de ex. 50 și 10), fiecare inspector ar primi un singur status.
        inspectorId: inspectorUsers[(n + Math.floor(n / STATUS_CYCLE.length)) % inspectorUsers.length].id,
        location: `${pick(BUILDINGS)}, ${pick(SPOTS)}`,
        dueDate: new Date(base + (n % 20) * 86400000).toISOString().slice(0, 10),
        status,
        answers,
        photos: [],
        reviewComment: status === 'returned' ? 'Completați observațiile pentru neconformități.' : null,
        clientUpdatedAt: new Date(base + n * 3600000)
      });
      if (status === 'approved') {
        submissions.push({ inspectionId: id, status: 'sent', attempts: 1, receiptNo: `SEED-${String(submissions.length + 1).padStart(6, '0')}` });
      }
    }
    // Inserare în loturi, ca seed-ul mare (5.000) să nu depășească limitele SQLite.
    for (let i = 0; i < rows.length; i += 500) await Inspection.bulkCreate(rows.slice(i, i + 500), { transaction });
    for (let i = 0; i < submissions.length; i += 500) await RegistrySubmission.bulkCreate(submissions.slice(i, i + 500), { transaction });

    return { coordinator, inspectors: inspectorUsers, templates, inspectionIds: rows.map((r) => r.id) };
  });
}

// Rulare din linia de comandă: npm run seed [-- --inspections 5000 --inspectors 50]
// (Comparația ignoră literele mari/mici: pe Windows, litera discului poate diferi, C: vs c:.)
const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const { parseArgs } = await import('node:util');
  const { config } = await import('./config.js');
  const { createDatabase } = await import('./db/index.js');
  const { values } = parseArgs({ options: { inspections: { type: 'string', default: '40' }, inspectors: { type: 'string', default: '3' } } });

  const db = await createDatabase({ storage: config.dbStorage });
  await db.sequelize.sync({ force: true });
  const result = await seedDatabase(db, { inspections: Number(values.inspections), inspectors: Number(values.inspectors) });
  console.log(`Seed gata în ${config.dbStorage}: 1 coordonator, ${result.inspectors.length} inspectori, ${result.templates.length} șabloane, ${result.inspectionIds.length} inspecții.`);
  console.log(`Conturi: coord / ${SEED_PASSWORDS.coordinator}, inspector1…${result.inspectors.length} / ${SEED_PASSWORDS.inspector}`);
  await db.sequelize.close();
}
