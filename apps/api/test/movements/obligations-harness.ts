import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { createAccountRoutes } from '../../src/accounts';
import { createCategoryRoutes } from '../../src/categories';
import {
  createAccountMovements,
  createCategoryUsage,
  createMovementRoutes,
} from '../../src/movements';
import type { DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
import {
  cookieHeader,
  seedUser,
  sessionFrom,
  signIn,
  type SessionCookies,
} from '../helpers/session-client';
import { trustedHeaders } from '../helpers/test-env';

const PASSWORD = 'a long enough passphrase';

export interface ObligationsSetup {
  app: Express;
  ana: SessionCookies;
  bob: SessionCookies;
  anaId: string;
  bobId: string;
}

/** The accounts, categories and movements routes wired with the REAL adapters, like `server.ts`. */
export async function obligationsSetup(connection: DatabaseConnection): Promise<ObligationsSetup> {
  const logger = createLogger({ level: 'error', destination: { write: () => undefined } });
  const { db } = connection;
  const harness = createIdentityHarness(connection, {
    realSessions: true,
    routerFactories: [
      createAccountRoutes({ db, logger, movements: createAccountMovements(db) }),
      createCategoryRoutes({ db, logger, usage: createCategoryUsage(db) }),
      createMovementRoutes({ db, logger }),
    ],
  });
  const suffix = randomUUID();
  const anaEmail = `ana-${suffix}@example.com`;
  const bobEmail = `bob-${suffix}@example.com`;
  const anaId = await seedUser(connection, { email: anaEmail, password: PASSWORD });
  const bobId = await seedUser(connection, { email: bobEmail, password: PASSWORD });
  const ana = sessionFrom(await signIn(harness.app, anaEmail, PASSWORD));
  const bob = sessionFrom(await signIn(harness.app, bobEmail, PASSWORD));
  return { app: harness.app, ana, bob, anaId, bobId };
}

export function get(app: Express, path: string, cookies: SessionCookies) {
  return request(app).get(path).set('Cookie', cookieHeader(cookies));
}

export function send(
  app: Express,
  method: 'post' | 'patch' | 'delete' | 'put',
  path: string,
  cookies: SessionCookies,
  body?: Record<string, unknown>,
) {
  const call = request(app)[method](path);
  return call.set(trustedHeaders).set('Cookie', cookieHeader(cookies)).send(body);
}

/** A manual-rate body, so no stored exchange rate is needed. */
export function movementBody(fields: {
  type: 'expense' | 'income';
  accountId: string;
  categoryId: string;
  amount: string;
}): Record<string, unknown> {
  return {
    ...fields,
    occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    rate: { source: 'manual', value: '14000000' },
  };
}
