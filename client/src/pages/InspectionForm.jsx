import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { engine } from '../lib/engine.js';
import { ANSWER_LABELS, formatDate, STATUS_LABELS } from '../lib/labels.js';
import { compressPhoto, MAX_PHOTOS } from '../lib/photos.js';

const LOCKED = ['submitted', 'approved'];
const SAVE_DELAY_MS = 400;

const formFrom = (i) => ({ templateId: i.templateId, location: i.location, answers: i.answers ?? {}, photos: i.photos ?? [] });

// Completarea unei inspecții (UC-05, UC-06, UC-07). Fiecare modificare se salvează local
// aproape imediat (IndexedDB), apoi se sincronizează dacă există rețea.
export default function InspectionForm({ state, online }) {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const existing = routeId ? state.inspections.find((i) => i.id === routeId) : null;

  const [form, setForm] = useState(() => (existing ? formFrom(existing) : { templateId: state.templates[0]?.id ?? '', location: '', answers: {}, photos: [] }));
  // Ref, nu state: salvarea de la părăsirea ecranului trebuie să vadă ID-ul curent.
  const idRef = useRef(routeId ?? null);
  const [missing, setMissing] = useState([]);
  const [photoError, setPhotoError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const timer = useRef(null);
  const latest = useRef(form);
  const savedAt = useRef(existing?.clientUpdatedAt);

  // Șabloanele pot sosi după deschiderea ecranului (prima sincronizare): se alege primul.
  useEffect(() => {
    if (!latest.current.templateId && state.templates[0]) {
      latest.current = { ...latest.current, templateId: state.templates[0].id };
      setForm(latest.current);
    }
  }, [state.templates]);

  // Dacă sincronizarea aduce o altă variantă de pe server (conflict), formularul o afișează.
  useEffect(() => {
    if (existing && !timer.current && existing.clientUpdatedAt !== savedAt.current) {
      savedAt.current = existing.clientUpdatedAt;
      setForm(formFrom(existing));
      latest.current = formFrom(existing);
    }
  }, [existing?.clientUpdatedAt, existing?.status]);

  const queue = useRef(Promise.resolve());

  // Salvările rulează pe rând, ca prima salvare a unei inspecții noi să-i fixeze ID-ul.
  function save(status = 'in_progress') {
    clearTimeout(timer.current);
    timer.current = null;
    // O salvare eșuată nu blochează coada: eroarea se afișează, iar următoarea salvare încearcă din nou.
    const attempt = queue.current.then(() => saveNow(status));
    queue.current = attempt.then(() => setSaveError(null), (error) => setSaveError(error.message));
    return attempt;
  }

  async function saveNow(status) {
    const data = latest.current;
    if (!data.templateId || data.location.trim().length < 3) return null;
    const isFirstSave = !idRef.current;
    const savedId = await engine.saveDraft({ id: idRef.current ?? undefined, ...data, templateId: Number(data.templateId), location: data.location.trim(), status });
    idRef.current = savedId;
    savedAt.current = engine.getInspection(savedId).clientUpdatedAt;
    if (isFirstSave) navigate(`/inspectii/${savedId}`, { replace: true });
    if (navigator.onLine) engine.sync();
    return savedId;
  }

  // La părăsirea ecranului, o salvare programată se face imediat.
  useEffect(() => () => { if (timer.current) save().catch(() => {}); }, []);

  function change(update) {
    const next = { ...latest.current, ...update };
    latest.current = next;
    setForm(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(), SAVE_DELAY_MS);
  }

  if (routeId && !existing) {
    return <p className="card">Inspecția nu există pe acest dispozitiv. <Link to="/">Înapoi la listă</Link></p>;
  }

  const template = state.templates.find((t) => t.id === Number(form.templateId));
  if (!existing && state.templates.length === 0) {
    return <p className="card">Șabloanele nu au fost descărcate încă. Conectează-te la internet o dată, ca să se sincronizeze.</p>;
  }
  // Blocată și când trimiterea spre revizie e încă doar pe dispozitiv (draft cu status „submitted”):
  // altfel, o atingere ar readuce-o în „în lucru”. Excepție: serverul a respins trimiterea (eroare),
  // caz în care inspectorul trebuie să o poată corecta.
  const locked = existing && LOCKED.includes(existing.status) && !existing.error;
  const isNew = !existing;

  const setAnswer = (questionId, patch) => {
    const previous = latest.current.answers[questionId] ?? { value: undefined, note: '' };
    const answer = { ...previous, ...patch };
    if (!answer.value) return;
    change({ answers: { ...latest.current.answers, [questionId]: { value: answer.value, note: answer.note ?? '' } } });
    setMissing((m) => m.filter((x) => x !== questionId));
  };

  async function addPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPhotoError(null);
    try {
      const dataUrl = await compressPhoto(file);
      change({ photos: [...latest.current.photos, dataUrl].slice(0, MAX_PHOTOS) });
    } catch (error) {
      setPhotoError(error.message);
    }
  }

  async function submit() {
    const unanswered = template.questions.filter((q) => !latest.current.answers[q.id]).map((q) => q.id);
    if (unanswered.length) {
      setMissing(unanswered);
      document.getElementById(`q-${unanswered[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    try {
      await save('submitted');
      navigate('/');
    } catch {
      // Mesajul e afișat de save(); inspectorul rămâne pe ecran.
    }
  }

  return (
    <section>
      <p><Link to="/">← Înapoi la listă</Link></p>
      <div className="page-title">
        <h1>{isNew ? 'Inspecție nouă' : form.location}</h1>
        {existing && <span className={`status status-${existing.status}`}>{STATUS_LABELS[existing.status]}</span>}
      </div>

      {existing?.notice && (
        <div className="notice card" role="status">
          <p>{existing.notice.message}</p>
          <button type="button" className="button-ghost" onClick={() => engine.dismissNotice(existing.id)}>Am înțeles</button>
        </div>
      )}
      {existing?.error && <p className="error card" role="alert">Serverul a respins ultima variantă: {existing.error}</p>}
      {existing?.status === 'returned' && existing.reviewComment && (
        <p className="notice card"><strong>Comentariul coordonatorului:</strong> {existing.reviewComment}</p>
      )}
      {locked && (
        <p className="card muted" role="status">
          Inspecția e {STATUS_LABELS[existing.status].toLowerCase()} și nu mai poate fi modificată
          {existing.hasDraft ? ' (se trimite la server la următoarea sincronizare)' : ''}.
        </p>
      )}
      {saveError && <p className="error card" role="alert">{saveError}</p>}

      <div className="card form">
        {isNew && (
          <label>
            Șablon
            <select value={form.templateId} onChange={(e) => change({ templateId: e.target.value, answers: {} })}>
              {state.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        <label>
          Locație
          <input value={form.location} onChange={(e) => change({ location: e.target.value })} disabled={locked} placeholder="De ex. Bloc A, parcare -2" required minLength={3} />
        </label>
        {isNew && form.location.trim().length < 3 && <p className="muted small">Completează locația (minimum 3 caractere) ca inspecția să se salveze.</p>}
        {existing?.dueDate && <p className="muted small">Termen: {formatDate(existing.dueDate)}</p>}
      </div>

      {template?.questions.map((q, index) => {
        const answer = form.answers[q.id];
        return (
          <fieldset key={q.id} id={`q-${q.id}`} className={`card question ${missing.includes(q.id) ? 'question-missing' : ''}`} disabled={locked}>
            <legend>{index + 1}. {q.text}</legend>
            <div className="choices">
              {Object.entries(ANSWER_LABELS).map(([value, label]) => (
                <label key={value} className={`choice choice-${value} ${answer?.value === value ? 'selected' : ''}`}>
                  <input type="radio" name={`answer-${q.id}`} value={value} checked={answer?.value === value} onChange={() => setAnswer(q.id, { value })} />
                  {label}
                </label>
              ))}
            </div>
            {missing.includes(q.id) && <p className="error small">Alege un răspuns.</p>}
            {answer && (
              <label className="small">
                Observație
                <textarea rows={2} maxLength={500} value={answer.note ?? ''} onChange={(e) => setAnswer(q.id, { note: e.target.value })} />
              </label>
            )}
          </fieldset>
        );
      })}

      {template && (
        <div className="card">
          <h2>Poze ({form.photos.length}/{MAX_PHOTOS})</h2>
          <div className="photos">
            {form.photos.map((src, index) => (
              <figure key={index} className="photo">
                <img src={src} alt={`Poza ${index + 1}`} />
                {!locked && <button type="button" className="button-ghost small" onClick={() => change({ photos: form.photos.filter((_, i) => i !== index) })}>Șterge</button>}
              </figure>
            ))}
          </div>
          {!locked && form.photos.length < MAX_PHOTOS && (
            <label className="button-secondary">
              Adaugă poză
              <input type="file" accept="image/*" capture="environment" onChange={addPhoto} hidden />
            </label>
          )}
          {photoError && <p className="error small">{photoError}</p>}
        </div>
      )}

      {template && !locked && (
        <div className="actions">
          <span className="muted small">{online ? 'Modificările se salvează și se sincronizează automat.' : 'Offline: modificările se salvează pe dispozitiv.'}</span>
          <button type="button" onClick={submit} disabled={form.location.trim().length < 3}>Trimite spre revizie</button>
        </div>
      )}
    </section>
  );
}
