import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import { ready } from './lib/engine.js';
import './styles.css';

// Service worker-ul păstrează aplicația în cache, ca să se deschidă și offline (pachetul OFF).
registerSW({ immediate: true });

const root = createRoot(document.getElementById('root'));

// Un singur tab activ pe dispozitiv: fiecare tab ține propria copie în memorie a datelor, deci două
// tab-uri și-ar suprascrie draft-urile în IndexedDB. Lacătul (Web Locks API) e eliberat automat la
// închiderea tab-ului; tab-ul care așteaptă se reîncarcă atunci și devine cel activ.
function acquireTab() {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks.request('firecheck-tab', { ifAvailable: true }, (lock) => {
      resolve(Boolean(lock));
      return lock ? new Promise(() => {}) : undefined;
    });
  });
}

acquireTab().then(async (active) => {
  if (!active) {
    root.render(
      <main className="page login-page">
        <h1 className="brand-large">FireCheck</h1>
        <p className="card notice" role="status" data-testid="other-tab">
          Aplicația e deja deschisă în alt tab sau altă fereastră. Folosește-o pe aceea, ca modificările
          să nu se suprascrie. Când o închizi, aplicația pornește aici automat.
        </p>
      </main>
    );
    navigator.locks.request('firecheck-tab', () => {
      window.location.reload();
      return new Promise(() => {});
    });
    return;
  }
  await ready;
  root.render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>
  );
});
