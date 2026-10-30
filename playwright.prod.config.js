import { defineConfig, devices } from '@playwright/test';

// Runs the E2E suite against the PRODUCTION server (server/app.mjs, as deployed on Render)
// serving the built dist/ with a real Postgres wire connection (PGlite socket server).
// Build first:  KF_SAME_ORIGIN_API=1 npm run build
const PORT = 8091;
const PG_PORT = 55433;

export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: ['**/parity.spec.js'],
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}/`, trace: 'retain-on-failure', serviceWorkers: 'block' },
  projects: [{ name: 'chromium-prod', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: `node tools/pg-dev.mjs --port ${PG_PORT}`, port: PG_PORT, reuseExistingServer: false },
    {
      command: 'node server/app.mjs',
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: false,
      env: { PORT: String(PORT), DATABASE_URL: `postgres://postgres@127.0.0.1:${PG_PORT}/postgres`, RUN_TOKEN_SECRET: 'prod-e2e-secret-0123456789abcdef', PG_POOL_MAX: '1' },
    },
  ],
});
