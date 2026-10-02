import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createInvestmentsRoutes } from '../../src/investments';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createLogger } from '../../src/shared/logging/logger';
import { MutableClock } from '../fakes/mutable-clock';
import { cookieHeader, seedUser, sessionFrom, signIn } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { testEnv } from '../helpers/test-env';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function buildApp(withClock: boolean) {
  const logger = createLogger({ level: 'silent' });
  return createApp({
    env: testEnv(),
    logger,
    // No requireSession override: the identity module's real session middleware is used.
    identity: { db: connection.db },
    routerFactories: [
      createInvestmentsRoutes({
        db: connection.db,
        logger,
        ...(withClock ? { clock: new MutableClock() } : {}),
      }),
    ],
  });
}

describe('investments module wiring', () => {
  it('mounts /investments behind the real requireSession', async () => {
    const app = buildApp(false);

    const forged = await request(app)
      .get('/investments/portfolios')
      .set('Cookie', cookieHeader({ accessToken: 'not-a-jwt' }));
    const anonymous = await request(app).get('/investments/portfolios');

    for (const response of [forged, anonymous]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
    }
  });

  it('serves a signed-in verified user, with the default system clock or an injected one', async () => {
    await seedUser(connection, {
      email: 'wired@wiring.test',
      password: 'a long enough passphrase',
    });

    for (const withClock of [false, true]) {
      const app = buildApp(withClock);
      const cookies = sessionFrom(
        await signIn(app, 'wired@wiring.test', 'a long enough passphrase'),
      );
      const response = await request(app)
        .get('/investments/portfolios')
        .set('Cookie', cookieHeader(cookies));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ portfolios: [] });
    }
  });

  it('refuses a module router factory without the identity module', () => {
    expect(() =>
      createApp({
        env: testEnv(),
        logger: createLogger({ level: 'silent' }),
        routerFactories: [
          createInvestmentsRoutes({ db: connection.db, logger: createLogger({ level: 'silent' }) }),
        ],
      }),
    ).toThrow(/identity/i);
  });
});
