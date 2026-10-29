import { defineConfig, devices } from '@playwright/test';

const PORT = 8090;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/vanilla/`,
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `node tools/serve.mjs --port ${PORT}`,
      port: PORT,
      reuseExistingServer: false,
      env: { KF_DEV_DB: '.data/e2e-db.json', RUN_TOKEN_SECRET: 'e2e-secret-0123456789abcdef' },
    },
    {
      command: 'npm run dev -w react',
      port: 5174,
      reuseExistingServer: false,
      env: { KF_REACT_PORT: '5174', KF_API_PROXY: `http://localhost:${PORT}` },
    },
  ],
});
