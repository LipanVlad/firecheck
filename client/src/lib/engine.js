import { useEffect, useState, useSyncExternalStore } from 'react';
import { createStore, get, set } from 'idb-keyval';
import { createRequest } from './http.js';
import { createSyncEngine } from './sync.js';

// Legătura dintre motorul de sincronizare și React: o singură instanță pentru toată aplicația.

const idb = createStore('firecheck', 'state');
const store = { get: (key) => get(key, idb), set: (key, value) => set(key, value, idb) };

export const request = createRequest();

let current = null;
const listeners = new Set();

export const engine = createSyncEngine({
  store,
  request,
  onChange: (snapshot) => {
    current = snapshot;
    listeners.forEach((listener) => listener());
  }
});

export const ready = engine.init().then(() => {
  // Cere browserului să nu șteargă datele locale când rămâne fără spațiu (poate refuza).
  navigator.storage?.persist?.();
});

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useEngine() {
  return useSyncExternalStore(subscribe, () => current);
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

// Cereri online pentru ecranele coordonatorului (fără coadă offline).
export async function api(method, path, body) {
  const token = engine.snapshot().session?.token;
  const response = await request(method, path, { token, body });
  if (response.status >= 400) {
    const error = new Error(response.body?.error?.message ?? `Eroare ${response.status}`);
    error.status = response.status;
    error.details = response.body?.error?.details ?? [];
    throw error;
  }
  return response.body;
}
