import { defineRailway, github, postgres, preserve, service } from 'railway/iac';

/** The partial owns only these services; the rest of the Railway project is left untouched. */
export const partial = 'pesly';

const source = github('MussiDev/pesly', { branch: 'main' });

const restart = { restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 10 } as const;

const apiWatchPatterns = ['apps/api/**', 'packages/shared/**', 'pnpm-lock.yaml'];

const WEB_ORIGIN = 'https://pesly.com.ar';

// Values in production today; secrets keep the value Railway already holds and never live here.
const shared = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
  WEB_BASE_URL: WEB_ORIGIN,
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM: 'Pesly <no-reply@pesly.com.ar>',
} as const;

const API_ORIGIN = 'https://api.pesly.com.ar';

export default defineRailway((_ctx, project) => {
  const db = postgres('argent-postgres');

  const api = service('argent-api', {
    source,
    build: {
      builder: 'RAILPACK',
      buildCommand: 'pnpm --filter @argent/api build',
      watchPatterns: apiWatchPatterns,
    },
    start: 'node --max-old-space-size=320 apps/api/dist/server.js',
    preDeploy: ['node apps/api/dist/shared/db/migrate.js'],
    deploy: restart,
    env: {
      ...shared,
      WEB_ORIGIN,
      API_ORIGIN,
      BREACH_CHECKER: 'hibp',
      TRUST_PROXY: '1',
      DATABASE_URL: db.env.DATABASE_URL,
      JWT_SECRET: preserve(),
      RESEND_API_KEY: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
    },
  });

  // Only the settings parseWorkerEnv reads (FIX-003).
  const worker = service('argent-worker', {
    source,
    build: {
      builder: 'RAILPACK',
      buildCommand: 'pnpm --filter @argent/api build',
      watchPatterns: apiWatchPatterns,
    },
    start: 'node --max-old-space-size=192 apps/api/dist/worker.js',
    deploy: restart,
    env: {
      ...shared,
      DATABASE_URL: db.env.DATABASE_URL,
      RESEND_API_KEY: preserve(),
    },
  });

  // Started with node directly, with no pnpm parent process (FIX-002).
  const web = service('argent-web', {
    source,
    build: {
      builder: 'RAILPACK',
      buildCommand: 'pnpm --filter @argent/web build',
      watchPatterns: ['apps/web/**', 'packages/shared/**', 'pnpm-lock.yaml'],
    },
    start: 'node --max-old-space-size=320 apps/web/node_modules/next/dist/bin/next start apps/web',
    deploy: restart,
    env: {
      NODE_ENV: 'production',
      API_ORIGIN,
    },
  });

  return project('pesly', { resources: [db, api, worker, web] });
});
