import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const WEB_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:4000';

/** Dedicated database for end-to-end runs; never the development database. */
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://argent:argent@localhost:5434/argent_e2e';

/**
 * The fake Google OpenID Connect server (apps/api/test/fake-google-oidc-server.ts). It listens on
 * 127.0.0.1, another site than the web app and API on localhost, so its consent page starts a
 * cross-site navigation back to the callback, as Google does.
 */
const FAKE_GOOGLE_ORIGIN = 'http://127.0.0.1:4100';
const FAKE_GOOGLE_CLIENT = {
  GOOGLE_CLIENT_ID: 'e2e-google-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'e2e-google-client-secret',
};

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
  ...FAKE_GOOGLE_CLIENT,
  GOOGLE_AUTHORIZATION_URL: `${FAKE_GOOGLE_ORIGIN}/authorize`,
  GOOGLE_TOKEN_URL: `${FAKE_GOOGLE_ORIGIN}/token`,
  GOOGLE_JWKS_URL: `${FAKE_GOOGLE_ORIGIN}/jwks`,
  GOOGLE_ISSUER: FAKE_GOOGLE_ORIGIN,
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
      // Stands in for Google, so no e2e test ever calls it.
      command: 'pnpm --filter @argent/api exec tsx test/fake-google-oidc-server.ts',
      url: `${FAKE_GOOGLE_ORIGIN}/jwks`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...FAKE_GOOGLE_CLIENT,
        FAKE_GOOGLE_PORT: '4100',
        FAKE_GOOGLE_REDIRECT_URI: `${API_URL}/auth/google/callback`,
      },
    },
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
