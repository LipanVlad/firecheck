import { useState } from 'react';
import { Link } from 'react-router';
import { formatDate, STATUS_LABELS } from '../lib/labels.js';

const FILTERS = [
  ['todo', 'De făcut', ['assigned', 'in_progress', 'returned']],
  ['sent', 'Trimise', ['submitted', 'approved']],
  ['all', 'Toate', null]
];

// Ordinea: întâi cele cu probleme sau nesincronizate, apoi după termen.
const rank = (i) => (i.error || i.notice ? 0 : i.pending ? 1 : 2);
const byPriority = (a, b) => rank(a) - rank(b) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.location.localeCompare(b.location);

export default function MyInspections({ state }) {
  const [filter, setFilter] = useState('todo');
  const statuses = FILTERS.find(([key]) => key === filter)[2];
  const templates = new Map(state.templates.map((t) => [t.id, t]));
  const items = state.inspections.filter((i) => !statuses || statuses.includes(i.status)).sort(byPriority);

  return (
    <section>
      <div className="page-title">
        <h1>Inspecțiile mele</h1>
        <Link className="button" to="/inspectii/noua">+ Inspecție nouă</Link>
      </div>

      <div className="tabs" role="tablist">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? 'tab active' : 'tab'} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      {items.length === 0 && <p className="card muted">Nicio inspecție aici.</p>}

      <ul className="list">
        {items.map((i) => (
          <li key={i.id}>
            <Link to={`/inspectii/${i.id}`} className="card card-link" data-testid="inspection-card">
              <div className="card-row">
                <strong>{i.location}</strong>
                <span className={`status status-${i.status}`}>{STATUS_LABELS[i.status]}</span>
              </div>
              <div className="card-row muted small">
                <span>{templates.get(i.templateId)?.name ?? 'Șablon'}</span>
                <span>Termen: {formatDate(i.dueDate)}</span>
              </div>
              {i.pending && <span className="badge badge-warn small">Nesincronizată</span>}
              {i.error && <p className="error small">{i.error}</p>}
              {i.notice && <p className="notice small">{i.notice.message}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
