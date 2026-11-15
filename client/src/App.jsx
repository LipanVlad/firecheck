import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import Header from './components/Header.jsx';
import { engine, useEngine, useOnline } from './lib/engine.js';
import Assign from './pages/Assign.jsx';
import CoordinatorInspections from './pages/CoordinatorInspections.jsx';
import InspectionDetail from './pages/InspectionDetail.jsx';
import InspectionForm from './pages/InspectionForm.jsx';
import Login from './pages/Login.jsx';
import MyInspections from './pages/MyInspections.jsx';
import Report from './pages/Report.jsx';
import Templates from './pages/Templates.jsx';

export const RETRY_INTERVAL_MS = 30_000;

export default function App() {
  const state = useEngine();
  const online = useOnline();
  const role = state.session?.user.role;

  // Sincronizare automată: la pornire și ori de câte ori revine rețeaua (doar pentru inspector).
  useEffect(() => {
    if (role === 'inspector' && online && !state.authExpired) engine.sync();
  }, [role, online, state.authExpired]);

  // Sincronizare periodică, la 30 s, cât aplicația e deschisă și online:
  // - semnal slab: browserul se crede online, dar serverul n-a răspuns, deci coada a rămas;
  // - fără nimic de trimis: aduce modificările de pe alte dispozitive (și mesajul de conflict,
  //   dacă modificarea de aici a fost înlocuită între timp).
  // Plus la revenirea în aplicație (tab-ul redevine vizibil).
  useEffect(() => {
    if (role !== 'inspector') return undefined;
    const tick = () => {
      const current = engine.snapshot();
      if (navigator.onLine && !current.syncing && !current.authExpired) engine.sync();
    };
    const timer = setInterval(tick, RETRY_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [role]);

  if (!state.session) return <Login />;

  return (
    <>
      <Header state={state} online={online} />
      <main className="page">
        {state.authExpired && <Login expired username={state.session.user.username} />}
        {role === 'inspector' ? (
          <Routes>
            <Route path="/" element={<MyInspections state={state} />} />
            <Route path="/inspectii/noua" element={<InspectionForm state={state} online={online} />} />
            <Route path="/inspectii/:id" element={<InspectionForm state={state} online={online} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        ) : (
          <Routes>
            <Route path="/" element={<CoordinatorInspections online={online} />} />
            <Route path="/inspectii/:id" element={<InspectionDetail online={online} />} />
            <Route path="/asignare" element={<Assign online={online} />} />
            <Route path="/sabloane" element={<Templates online={online} />} />
            <Route path="/raport" element={<Report online={online} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        )}
      </main>
    </>
  );
}
