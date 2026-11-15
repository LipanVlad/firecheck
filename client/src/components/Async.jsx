import { useCallback, useEffect, useState } from 'react';

// Încarcă date de la API și ține evidența stărilor: încărcare, eroare, succes.
export function useLoad(load, deps) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ loading: false, error: null, data: await load() });
    } catch (error) {
      setState({ loading: false, error, data: null });
    }
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function Loading() {
  return <p className="card muted" role="status">Se încarcă…</p>;
}

export function ErrorBox({ error, retry }) {
  return (
    <div className="card error" role="alert">
      <p>{error.message}</p>
      {retry && <button type="button" onClick={retry}>Încearcă din nou</button>}
    </div>
  );
}

export function OfflineNotice() {
  return <p className="card notice">Ești offline. Ecranele coordonatorului au nevoie de conexiune la internet.</p>;
}
