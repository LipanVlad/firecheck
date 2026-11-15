import { useState } from 'react';
import { engine } from '../lib/engine.js';

// expired = sesiunea a expirat, dar datele locale rămân; utilizatorul se autentifică din nou.
export default function Login({ expired = false, username: knownUsername = '' }) {
  const [username, setUsername] = useState(knownUsername);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await engine.login(username, password);
      if (!result.ok) setError(result.message);
      else if (result.user.role === 'inspector') engine.sync();
    } catch (err) {
      setError(`${err.message}. Prima autentificare necesită conexiune la internet.`);
    } finally {
      setLoading(false);
    }
  }

  const form = (
    <form className="card form" onSubmit={submit}>
      <h2>{expired ? 'Sesiunea a expirat' : 'Autentificare'}</h2>
      {expired && <p className="muted">Modificările tale sunt salvate pe dispozitiv și se trimit după autentificare. Pentru alt cont, folosește „Ieșire”.</p>}
      <label>
        Utilizator
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required readOnly={expired} />
      </label>
      <label>
        Parolă
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={loading}>{loading ? 'Se verifică…' : 'Intră în cont'}</button>
    </form>
  );

  if (expired) return form;
  return (
    <main className="page login-page">
      <h1 className="brand-large">FireCheck</h1>
      <p className="muted">Inspecții PSI de teren, cu funcționare offline.</p>
      {form}
    </main>
  );
}
