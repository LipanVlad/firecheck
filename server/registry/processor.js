import { nextDelayMs } from './backoff.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Procesorul trimiterilor la Registrul PSI (pachetul EXT, docs/architecture.md secțiunea 7).
//
// Stări: pending → sending → sent | failed; între încercări se revine la pending,
// cu nextAttemptAt completat. Starea e în baza de date, deci supraviețuiește unui restart.
export function createRegistryProcessor({
  db,
  client,
  maxAttempts = 5,
  baseDelayMs = 1000,
  // Retry-After e respectat; plafonul protejează doar de valori absurde (de ex. o zi).
  maxRetryAfterMs = 10 * 60 * 1000,
  sleep = defaultSleep,
  log = (message) => console.log(`[registru] ${message}`)
}) {
  const { RegistrySubmission, Inspection, Template, User } = db.models;
  const running = new Map();
  let stopped = false;

  // „Revendică” trimiterea: o trece din pending în sending doar dacă e încă pending.
  // Dacă alt proces sau alt apel a revendicat-o deja, actualizarea nu afectează niciun rând.
  async function claim(inspectionId) {
    const [count] = await db.write((transaction) => RegistrySubmission.update(
      { status: 'sending' },
      { where: { inspectionId, status: 'pending' }, transaction }
    ));
    return count === 1;
  }

  async function buildReport(inspectionId) {
    const inspection = await Inspection.findByPk(inspectionId, {
      include: [Template, { model: User, as: 'inspector', attributes: ['fullName'] }]
    });
    const counts = { pass: 0, fail: 0, na: 0 };
    const nonConformities = [];
    for (const question of inspection.Template.questions) {
      const answer = inspection.answers[question.id];
      if (!answer) continue;
      counts[answer.value] += 1;
      if (answer.value === 'fail') nonConformities.push({ question: question.text, note: answer.note ?? '' });
    }
    return {
      inspectionId,
      location: inspection.location,
      templateName: inspection.Template.name,
      inspectorName: inspection.inspector.fullName,
      approvedAt: inspection.updatedAt.toISOString(),
      summary: counts,
      nonConformities
    };
  }

  const save = (submission, values) => db.write((transaction) => submission.update(values, { transaction }));

  async function run(inspectionId) {
    // După un restart, se respectă pauza programată înainte de oprire. Cât așteaptă, trimiterea
    // rămâne `pending` (starea afișată e cea reală); abia apoi e revendicată.
    const scheduled = await RegistrySubmission.findOne({ where: { inspectionId } });
    const wait = scheduled?.nextAttemptAt ? scheduled.nextAttemptAt.getTime() - Date.now() : 0;
    if (wait > 0) await sleep(wait);
    if (stopped || !(await claim(inspectionId))) return;
    const report = await buildReport(inspectionId);

    while (!stopped) {
      const submission = await RegistrySubmission.findOne({ where: { inspectionId } });
      const attempt = submission.attempts + 1;
      await save(submission, { attempts: attempt, nextAttemptAt: null });

      // Cheia de idempotență e ID-ul inspecției: aceeași la fiecare încercare și după restart.
      const result = await client.submit(report, inspectionId);

      if (result.ok) {
        // Chitanța se scrie o singură dată; un răspuns duplicat aduce aceeași chitanță.
        await save(submission, { status: 'sent', receiptNo: submission.receiptNo ?? result.receiptNo, lastError: null });
        log(`${inspectionId}: trimisă la încercarea ${attempt} (${result.receiptNo}${result.duplicate ? ', duplicat' : ''})`);
        return;
      }

      if (!result.retryable || attempt >= maxAttempts) {
        await save(submission, { status: 'failed', lastError: result.error });
        log(`${inspectionId}: eșuată după ${attempt} încercări (${result.error})`);
        return;
      }

      const delay = nextDelayMs({ attempt, baseDelayMs, retryAfterMs: result.retryAfterMs, maxRetryAfterMs });
      await save(submission, { status: 'pending', lastError: result.error, nextAttemptAt: new Date(Date.now() + delay) });
      log(`${inspectionId}: încercarea ${attempt} a eșuat (${result.error}); următoarea peste ${delay} ms`);
      await sleep(delay);
      if (stopped || !(await claim(inspectionId))) return;
    }
  }

  // Pornește trimiterea unei inspecții. Apelurile repetate pentru aceeași inspecție, cât timp
  // una rulează deja, primesc aceeași promisiune (nu pornesc o a doua trimitere).
  // O eroare neprevăzută (în afara răspunsurilor clasificate de client) nu lasă trimiterea
  // blocată în `sending`: devine `failed`, cu mesajul erorii, și poate fi retrimisă manual.
  async function markFailed(inspectionId, error) {
    log(`${inspectionId}: eroare neașteptată: ${error.message}`);
    try {
      await db.write((transaction) => RegistrySubmission.update(
        { status: 'failed', lastError: `eroare internă: ${error.message}`.slice(0, 300) },
        { where: { inspectionId, status: ['sending', 'pending'] }, transaction }
      ));
    } catch (inner) {
      log(`${inspectionId}: nu s-a putut marca eșuată: ${inner.message}`);
    }
  }

  function process(inspectionId) {
    if (running.has(inspectionId)) return running.get(inspectionId);
    const promise = run(inspectionId)
      .catch((error) => markFailed(inspectionId, error))
      .finally(() => running.delete(inspectionId));
    running.set(inspectionId, promise);
    return promise;
  }

  // La pornirea serverului: trimiterile rămase `sending` au fost întrerupte de oprire,
  // deci redevin `pending`; apoi toate trimiterile `pending` sunt reluate.
  async function resume() {
    await db.write((transaction) => RegistrySubmission.update(
      { status: 'pending' },
      { where: { status: 'sending' }, transaction }
    ));
    const pending = await RegistrySubmission.findAll({ where: { status: 'pending' }, attributes: ['inspectionId'] });
    return Promise.all(pending.map((s) => process(s.inspectionId)));
  }

  // Așteaptă terminarea trimiterilor în curs (folosit de teste și la oprire).
  async function idle() {
    while (running.size) await Promise.all(running.values());
  }

  async function stop() {
    stopped = true;
    await idle();
  }

  return { process, resume, idle, stop };
}
