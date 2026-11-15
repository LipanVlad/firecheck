import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Interfața React stă în client/. În dezvoltare, Vite redirecționează /api către serverul
// Express, deci browserul vede o singură origine și nu e nevoie de CORS.
export default defineConfig({
  root: 'client',
  plugins: [
    react(),
    // Service worker generat la build (pachetul OFF, ADR-001): păstrează în cache HTML, CSS și JS,
    // ca aplicația să se deschidă și să se reîncarce fără rețea. Cererile /api nu sunt puse în
    // cache: datele offline stau în IndexedDB, gestionate de modulul de sincronizare.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'FireCheck — inspecții PSI',
        short_name: 'FireCheck',
        lang: 'ro',
        start_url: '/',
        display: 'standalone',
        background_color: '#faf8f7',
        theme_color: '#b3261e',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        clientsClaim: true,
        skipWaiting: true
      }
    })
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' }
  },
  build: { outDir: 'dist', emptyOutDir: true }
});
