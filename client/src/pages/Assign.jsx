import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorBox, Loading, OfflineNotice, useLoad } from '../components/Async.jsx';
import { api } from '../lib/engine.js';

// UC-03: coordonatorul asignează o inspecție unui inspector.
export default function Assign({ online }) {
  const options = useLoad(async () => ({ templates: await api('GET', '/api/templates'), inspectors: await api('GET', '/api/users') }), []);
  const [form, setForm] = useState({ templateId: '', inspectorId: '', location: '', dueDate: '' });
  const [result, setResult] = useState({ busy: false, error: null, created: null });

  if (!online) return <OfflineNotice />;
  if (options.loading) return <Loading />;
  if (options.error) return <ErrorBox error={options.error} retry={options.reload} />;

  const { templates, inspectors } = options.data;
  const value = (key) => form[key] || (key === 'templateId' ? templates[0]?.id : key === 'inspectorId' ? inspectors[0]?.id : '') || '';

  async function submit(event) {
    event.preventDefault();
    setResult({ busy: true, error: null, created: null });
    try {
      const body = { templateId: Number(value('templateId')), inspectorId: Number(value('inspectorId')), location: form.location.trim() };
      if (form.dueDate) body.dueDate = form.dueDate;
      const created = await api('POST', '/api/inspections', body);
      setResult({ busy: false, error: null, created });
      setForm((f) => ({ ...f, location: '', dueDate: '' }));
    } catch (error) {
      setResult({ busy: false, error, created: null });
    }
  }

  return (
    <section>
      <h1>Asignare inspecție</h1>
      <form className="card form" onSubmit={submit}>
        <label>
          Șablon
          <select value={value('templateId')} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>
          Inspector
          <select value={value('inspectorId')} onChange={(e) => setForm({ ...form, inspectorId: e.target.value })}>
            {inspectors.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
          </select>
        </label>
        <label>
          Locație
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} minLength={3} maxLength={200} required placeholder="De ex. Bloc A, parcare -2" />
        </label>
        <label>
          Termen
          <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        </label>
        <button type="submit" disabled={result.busy}>{result.busy ? 'Se salvează…' : 'Asignează'}</button>
      </form>
      {result.error && <ErrorBox error={result.error} />}
      {result.created && (
        <p className="card ok" role="status">
          Inspecția a fost asignată. <Link to={`/inspectii/${result.created.id}`}>Vezi inspecția</Link>
        </p>
      )}
    </section>
  );
}
