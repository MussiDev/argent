import type { Express } from 'express';
import { createApp, type RouterFactory } from '../../src/app';
import { createEmailWorker } from '../../src/identity';
import type { BreachedPasswordChecker } from '../../src/identity/application/ports/breached-password-checker';
import type { EmailWorker } from '../../src/identity/infrastructure/email/email-worker';
import type { DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { CapturingTransport } from '../fakes/capturing-transport';
import type { FakeGoogleOidc } from '../fixtures/fake-google-oidc';
import { MutableClock } from '../fakes/mutable-clock';
import { testRequireSession } from '../fakes/test-session';
import { testEnv } from './test-env';

/** Links in emails must come from here, never from the request (threat R-08). */
export const LINK_BASE_URL = 'https://links.argent.test';

export interface IdentityHarness {
  app: Express;
  worker: EmailWorker;
  transport: CapturingTransport;
  clock: MutableClock;
  /** Every log line written by the app and the worker, as JSON strings. */
  lines: string[];
}

export interface IdentityHarnessOptions {
  breachedPasswordChecker?: BreachedPasswordChecker;
  /**
   * Use the real `requireSession` (JWT + session row) instead of the test double that trusts the
   * `x-test-user-id` header.
   */
  realSessions?: boolean;
  /** Environment overrides, e.g. `TRUST_PROXY: '1'` to vary client IPs with X-Forwarded-For. */
  env?: Record<string, string>;
  /**
   * A running fake OIDC server (`startFakeGoogleOidc()`, started by the test file) whose GOOGLE_*
   * variables configure Google sign-in. Without it Google sign-in is unconfigured.
   */
  google?: FakeGoogleOidc;
  /** Other modules' routers, built with the real `requireSession`. */
  routerFactories?: RouterFactory[];
  /** Test-only routers (fixtures); `createApp` mounts them only when NODE_ENV is `test`. */
  testRouterFactories?: RouterFactory[];
}

/** The API with the identity routes and an email worker, sharing one clock and one transport. */
export function createIdentityHarness(
  connection: DatabaseConnection,
  options: IdentityHarnessOptions = {},
): IdentityHarness {
  const lines: string[] = [];
  const logger = createLogger({
    level: 'debug',
    destination: { write: (line: string) => lines.push(line) },
  });
  const env = testEnv({ WEB_BASE_URL: LINK_BASE_URL, ...options.google?.env, ...options.env });
  const clock = new MutableClock();
  const transport = new CapturingTransport();
  const app = createApp({
    env,
    logger,
    identity: {
      db: connection.db,
      clock,
      ...(options.realSessions ? {} : { requireSession: testRequireSession }),
      ...(options.breachedPasswordChecker
        ? { breachedPasswordChecker: options.breachedPasswordChecker }
        : {}),
    },
    ...(options.routerFactories ? { routerFactories: options.routerFactories } : {}),
    ...(options.testRouterFactories ? { testRouterFactories: options.testRouterFactories } : {}),
  });
  const worker = createEmailWorker({ db: connection.db, env, logger, transport, clock });
  return { app, worker, transport, clock, lines };
}

export function logEntries(lines: string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}
