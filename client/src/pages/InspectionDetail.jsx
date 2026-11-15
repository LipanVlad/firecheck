import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorBox, Loading, OfflineNotice, useLoad } from '../components/Async.jsx';
import { api } from '../lib/engine.js';
import { ANSWER_LABELS, formatDate, formatDateTime, REGISTRY_LABELS, STATUS_LABELS } from '../lib/labels.js';

// Detaliile unei inspecții pentru coordonator: răspunsuri, revizie și trimiterea la Registrul PSI.
export default function InspectionDetail({ online }) {
  const { id } = useParams();
  const inspection = useLoad(() => api('GET', `/api/inspections/${id}`), [id]);
  const templates = useLoad(() => api('GET', '/api/templates'), []);
  const [comment, setComment] = useState('');
  const [action, setAction] = useState({ busy: false, error: null });

  // Cât trimiterea la Registru e în curs, starea se reîmprospătează la 2 secunde.
  const registryStatus = inspection.data?.registry?.status;
  useEffect(() => {
    if (registryStatus !== 'pending' && registryStatus !== 'sending') return undefined;
    const timer = setInterval(inspection.reload, 2000);
    return () => clearInterval(timer);
  }, [registryStatus, inspection.reload]);

  async function run(fn) {
    setAction({ busy: true, error: null });
    try {
      await fn();
      await inspection.reload();
      setAction({ busy: false, error: null });
    } catch (error) {
      setAction({ busy: false, error });
    }
  }

  if (!online) return <OfflineNotice />;
  if (inspection.loading && !inspection.data) return <Loading />;
  if (inspection.error) return <ErrorBox error={inspection.error} retry={inspection.reload} />;

  const i = inspection.data;
  const template = templates.data?.find((t) => t.id === i.templateId);
  const registry = i.registry;

  return (
    <section>
      <p><Link to="/">← Înapoi la listă</Link></p>
      <div className="page-title">
        <h1>{i.location}</h1>
        <span className={`status status-${i.status}`}>{STATUS_LABELS[i.status]}</span>
      </div>
      <p className="muted">{template?.name} · {i.inspectorName} · Termen: {formatDate(i.dueDate)}</p>
      {i.reviewComment && <p className="notice card"><strong>Comentariu revizie:</strong> {i.reviewComment}</p>}

      <div className="card">
        <h2>Răspunsuri</h2>
        {template?.questions.map((q) => {
          const answer = i.answers[q.id];
          return (
            <div key={q.id} className="answer-row">
              <span>{q.text}</span>
              <span className={`answer answer-${answer?.value ?? 'none'}`}>{answer ? ANSWER_LABELS[answer.value] : '—'}</span>
              {answer?.note && <span className="muted small answer-note">{answer.note}</span>}
            </div>
          );
        })}
        {i.photos.length > 0 && (
          <div className="photos">
            {i.photos.map((src, index) => <img key={index} src={src} alt={`Poza ${index + 1}`} className="photo" />)}
          </div>
        )}
      </div>

      {i.status === 'submitted' && (
        <div className="card form">
          <h2>Revizie</h2>
          <button type="button" disabled={action.busy} onClick={() => run(() => api('POST', `/api/inspections/${id}/review`, { decision: 'approve' }))}>
            Aprobă și trimite la Registru
          </button>
          <label>
            Comentariu pentru returnare (minimum 5 caractere)
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
          </label>
          <button type="button" className="button-secondary" disabled={action.busy || comment.trim().length < 5}
            onClick={() => run(() => api('POST', `/api/inspections/${id}/review`, { decision: 'return', comment: comment.trim() }))}>
            Returnează inspectorului
          </button>
        </div>
      )}

      {registry && (
        <div className="card" data-testid="registry-status">
          <h2>Registrul PSI</h2>
          <p>
            Stare: <span className={`status registry-${registry.status}`}>{REGISTRY_LABELS[registry.status]}</span>
            {' '}· încercări: {registry.attempts}
          </p>
          {registry.receiptNo && <p>Chitanță: <strong data-testid="receipt">{registry.receiptNo}</strong></p>}
          {registry.lastError && <p className="muted small">Ultima eroare: {registry.lastError}</p>}
          {registry.nextAttemptAt && registry.status === 'pending' && <p className="muted small">Următoarea încercare: {formatDateTime(registry.nextAttemptAt)}</p>}
          {registry.status === 'failed' && (
            <button type="button" disabled={action.busy} onClick={() => run(() => api('POST', `/api/inspections/${id}/registry/retry`))}>Retrimite</button>
          )}
        </div>
      )}

      {action.error && <ErrorBox error={action.error} />}
    </section>
  );
}
