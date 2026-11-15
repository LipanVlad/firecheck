import { NavLink } from 'react-router';
import { engine } from '../lib/engine.js';
import { formatDateTime } from '../lib/labels.js';

const INSPECTOR_LINKS = [['/', 'Inspecțiile mele']];
const COORDINATOR_LINKS = [['/', 'Inspecții'], ['/asignare', 'Asignare'], ['/sabloane', 'Șabloane'], ['/raport', 'Raport']];

export default function Header({ state, online }) {
  const { user } = state.session;
  const isInspector = user.role === 'inspector';
  const links = isInspector ? INSPECTOR_LINKS : COORDINATOR_LINKS;

  async function logout() {
    if (state.unsavedCount > 0 && !window.confirm(`Ai ${state.unsavedCount} modificări nesincronizate. Dacă te deloghezi acum, se pierd. Continui?`)) return;
    await engine.logout();
  }

  return (
    <header className="topbar">
      <div className="topbar-row">
        <span className="brand">FireCheck</span>
        <div className="topbar-status">
          <span className={`badge ${online ? 'badge-ok' : 'badge-off'}`} data-testid="network-status">{online ? 'Online' : 'Offline'}</span>
          {/* Toate modificările nesalvate încă pe server: în coadă sau respinse de server (de corectat). */}
          {isInspector && (
            <span className={`badge ${state.unsavedCount ? 'badge-warn' : 'badge-muted'}`} data-testid="pending-count">
              {state.unsavedCount} nesincronizate
            </span>
          )}
        </div>
      </div>

      <div className="topbar-row">
        <nav className="nav" aria-label="Navigare principală">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
          ))}
        </nav>
        <div className="topbar-user">
          <span className="muted">{user.fullName}</span>
          <button type="button" className="button-ghost" onClick={logout}>Ieșire</button>
        </div>
      </div>

      {isInspector && (
        <div className="topbar-row sync-row" aria-live="polite">
          <button type="button" onClick={() => engine.sync()} disabled={!online || state.syncing} data-testid="sync-button">
            {state.syncing ? 'Se sincronizează…' : 'Sincronizează'}
          </button>
          <span className="muted small">
            {state.lastError ? <span className="error">{state.lastError}</span> : `Ultima sincronizare: ${formatDateTime(state.lastSync)}`}
          </span>
        </div>
      )}
    </header>
  );
}
