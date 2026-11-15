import { defineConfig, devices } from '@playwright/test';

// Testele end-to-end și ale pachetului OFF rulează pe build-ul de producție (singurul în care
// service worker-ul e activ), într-un browser Chromium cu dimensiunile unui telefon.
//
// Browserul: `npx playwright install chromium` (o singură dată). Alternativ, CHROME_PATH poate
// indica un Chrome deja instalat.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
  },
  projects: [{ name: 'telefon', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'node e2e/server.js',
    url: 'http://localhost:3100/api/health',
    reuseExistingServer: false,
    timeout: 60_000
  }
});
