import { useState } from 'react';
import { ErrorBox, Loading, OfflineNotice, useLoad } from '../components/Async.jsx';
import { api } from '../lib/engine.js';

// F5: șabloanele se pot doar crea și vedea (sunt imutabile, R9).
export default function Templates({ online }) {
  const templates = useLoad(() => api('GET', '/api/templates'), []);
  const [name, setName] = useState('');
  const [questions, setQuestions] = useState('');
  const [result, setResult] = useState({ busy: false, error: null });

  if (!online) return <OfflineNotice />;

  async function submit(event) {
    event.preventDefault();
    setResult({ busy: true, error: null });
    try {
      const list = questions.split('\n').map((q) => q.trim()).filter(Boolean);
      await api('POST', '/api/templates', { name: name.trim(), questions: list });
      setName('');
      setQuestions('');
      setResult({ busy: false, error: null });
      templates.reload();
    } catch (error) {
      setResult({ busy: false, error });
    }
  }

  return (
    <section>
      <h1>Șabloane</h1>
      <form className="card form" onSubmit={submit}>
        <h2>Șablon nou</h2>
        <label>
          Nume
          <input value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={100} required />
        </label>
        <label>
          Întrebări (câte una pe rând, maximum 30)
          <textarea rows={5} value={questions} onChange={(e) => setQuestions(e.target.value)} required />
        </label>
        <p className="muted small">După creare, un șablon nu se mai poate modifica.</p>
        <button type="submit" disabled={result.busy}>Creează șablonul</button>
        {result.error && <ErrorBox error={result.error} />}
      </form>

      {templates.loading && <Loading />}
      {templates.error && <ErrorBox error={templates.error} retry={templates.reload} />}
      {templates.data?.map((t) => (
        <div key={t.id} className="card">
          <h2>{t.name}</h2>
          <ol>{t.questions.map((q) => <li key={q.id}>{q.text}</li>)}</ol>
        </div>
      ))}
    </section>
  );
}
