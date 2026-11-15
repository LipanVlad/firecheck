import { useState } from 'react';
import { ErrorBox, Loading, OfflineNotice, useLoad } from '../components/Async.jsx';
import { api } from '../lib/engine.js';
import { REGISTRY_LABELS, STATUS_LABELS } from '../lib/labels.js';

// F4: raportul central.
export default function Report({ online }) {
  const [filters, setFilters] = useState({ from: '', to: '', inspectorId: '' });
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  const report = useLoad(() => api('GET', `/api/report?${query}`), [query]);
  const inspectors = useLoad(() => api('GET', '/api/users'), []);

  if (!online) return <OfflineNotice />;

  return (
    <section>
      <h1>Raport central</h1>
      <div className="card filters">
        <label>De la <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label>Până la <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <label>
          Inspector
          <select value={filters.inspectorId} onChange={(e) => setFilters({ ...filters, inspectorId: e.target.value })}>
            <option value="">Toți</option>
            {inspectors.data?.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        </label>
      </div>

      {report.loading && !report.data && <Loading />}
      {report.error && <ErrorBox error={report.error} retry={report.reload} />}
      {report.data && (
        <>
          <div className="stats">
            <div className="stat card"><span className="stat-value">{report.data.total}</span><span className="muted">Total</span></div>
            {Object.entries(report.data.byStatus).map(([status, n]) => (
              <div key={status} className="stat card"><span className="stat-value">{n}</span><span className="muted">{STATUS_LABELS[status]}</span></div>
            ))}
          </div>

          <div className="card table-wrap">
            <h2>Pe inspector</h2>
            <table>
              <thead>
                <tr><th>Inspector</th>{Object.values(STATUS_LABELS).map((l) => <th key={l}>{l}</th>)}</tr>
              </thead>
              <tbody>
                {report.data.byInspector.map((row) => (
                  <tr key={row.inspectorId}>
                    <td>{row.inspectorName}</td>
                    {Object.keys(STATUS_LABELS).map((s) => <td key={s}>{row[s]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Cele mai frecvente neconformități</h2>
            {report.data.topNonConformities.length === 0 && <p className="muted">Nicio neconformitate.</p>}
            <ol>
              {report.data.topNonConformities.map((n) => (
                <li key={`${n.templateId}-${n.questionId}`}>{n.questionText} — <strong>{n.failCount}</strong></li>
              ))}
            </ol>
          </div>

          <div className="card">
            <h2>Trimiteri la Registrul PSI</h2>
            <ul className="inline-list">
              {Object.entries(report.data.registry).map(([status, n]) => <li key={status}>{REGISTRY_LABELS[status]}: <strong>{n}</strong></li>)}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
