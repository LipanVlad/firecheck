import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ErrorBox, Loading, OfflineNotice, useLoad } from '../components/Async.jsx';
import { api } from '../lib/engine.js';
import { formatDate, STATUS_LABELS } from '../lib/labels.js';

const SORTS = [['updatedAt', 'Ultima modificare'], ['dueDate', 'Termen'], ['location', 'Locație'], ['status', 'Status']];

// Lista tuturor inspecțiilor, cu filtrare, sortare și paginare făcute pe server (secțiunea 7 din cerințe).
// Filtrele stau în adresa paginii, deci o căutare se poate trimite cuiva ca link.
export default function CoordinatorInspections({ online }) {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const query = params.toString();

  const inspectors = useLoad(() => api('GET', '/api/users'), []);
  const page = useLoad(() => api('GET', `/api/inspections?pageSize=10&${query}`), [query]);

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  if (!online) return <OfflineNotice />;

  const current = Number(params.get('page') ?? 1);
  const order = params.get('order') ?? 'desc';

  return (
    <section>
      <div className="page-title">
        <h1>Inspecții</h1>
        <Link className="button" to="/asignare">+ Asignare</Link>
      </div>

      <form className="card filters" onSubmit={(e) => { e.preventDefault(); set('q', text.trim().length >= 2 ? text.trim() : ''); }}>
        <label>
          Caută în locație
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="minimum 2 caractere" />
        </label>
        <label>
          Status
          <select value={params.get('status') ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Toate</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Inspector
          <select value={params.get('inspectorId') ?? ''} onChange={(e) => set('inspectorId', e.target.value)}>
            <option value="">Toți</option>
            {inspectors.data?.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        </label>
        <label>
          Termen până la
          <input type="date" value={params.get('dueBefore') ?? ''} onChange={(e) => set('dueBefore', e.target.value)} />
        </label>
        <label>
          Sortare
          <select value={params.get('sort') ?? 'updatedAt'} onChange={(e) => set('sort', e.target.value)}>
            {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" className="button-secondary" onClick={() => set('order', order === 'asc' ? 'desc' : 'asc')}>
          {order === 'asc' ? '↑ Crescător' : '↓ Descrescător'}
        </button>
        <button type="submit">Caută</button>
      </form>

      {page.loading && <Loading />}
      {page.error && <ErrorBox error={page.error} retry={page.reload} />}
      {page.data && (
        <>
          <p className="muted small">{page.data.total} inspecții</p>
          <ul className="list">
            {page.data.items.map((i) => (
              <li key={i.id}>
                <Link to={`/inspectii/${i.id}`} className="card card-link" data-testid="inspection-row">
                  <div className="card-row">
                    <strong>{i.location}</strong>
                    <span className={`status status-${i.status}`}>{STATUS_LABELS[i.status]}</span>
                  </div>
                  <div className="card-row muted small">
                    <span>{i.inspectorName}</span>
                    <span>Termen: {formatDate(i.dueDate)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {page.data.totalPages > 1 && (
            <nav className="pager" aria-label="Paginare">
              <button type="button" className="button-secondary" disabled={current <= 1} onClick={() => set('page', String(current - 1))}>← Anterioară</button>
              <span>Pagina {current} din {page.data.totalPages}</span>
              <button type="button" className="button-secondary" disabled={current >= page.data.totalPages} onClick={() => set('page', String(current + 1))}>Următoarea →</button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
