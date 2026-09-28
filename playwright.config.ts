import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const WEB_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:4000';

/** Dedicated database for end-to-end runs; never the development database. */
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://argent:argent@localhost:5434/argent_e2e';

/** Environment shared by the e2e API and its email worker: same database, secret and URLs. */
const API_ENV = {
  E2E_DATABASE_URL,
  DATABASE_URL: E2E_DATABASE_URL,
  JWT_SECRET: 'e2e-only-secret-that-is-at-least-thirty-two-bytes',
  WEB_ORIGIN: WEB_URL,
  API_ORIGIN: API_URL,
  WEB_BASE_URL: WEB_URL,
  EMAIL_PROVIDER: 'mailpit',
  BREACH_CHECKER: 'fake',
};

export default defineConfig({
  testDir: './apps/web/e2e',
  // End-to-end flows share one database and one Mailpit inbox.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Playwright starts webServers before globalSetup, so the e2e database is created and
      // migrated as part of the API command, before the API boots.
      command:
        'pnpm --filter @argent/api exec tsx test/e2e-database.ts && pnpm --filter @argent/api start',
      url: `${API_URL}/health`,
      // Never reuse a running API: it could be pointed at another database.
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: '4000', ...API_ENV },
    },
    {
      // Delivers the outbox to Mailpit; without it no verification or reset email is ever sent.
      // Started after the API command, which creates and migrates the e2e database.
      command: 'pnpm --filter @argent/api worker',
      wait: { stdout: /email worker started/ },
      reuseExistingServer: false,
      timeout: 60_000,
      env: API_ENV,
    },
    {
      command: isCI
        ? 'pnpm --filter @argent/web build && pnpm --filter @argent/web start'
        : 'pnpm --filter @argent/web dev',
      url: `${WEB_URL}/es`,
      reuseExistingServer: !isCI,
      timeout: 180_000,
      env: {
        API_ORIGIN: API_URL,
      },
    },
  ],
});
