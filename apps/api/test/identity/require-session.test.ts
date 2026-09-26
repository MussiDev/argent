import { Router, type RequestHandler } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { validate } from '../../src/shared/http/validate';
import { createLogger } from '../../src/shared/logging/logger';
import { createIdentityHarness } from '../helpers/identity-harness';
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

const PASSWORD = 'a long enough passphrase';

/** What another module's router would do: mount the shared requireSession and read `auth`. */
function probeRouter({ requireSession }: { requireSession: RequestHandler }) {
  const router = Router();
  router.get(
    '/probe',
    requireSession,
    validate({}, (_input, { res, auth }) => {
      res.json({ auth });
    }),
  );
  return router;
}

describe('requireSession for other modules (A-1)', () => {
  it('is handed to router factories and fills AuthContext with userId, sessionId and emailVerified', async () => {
    const harness = createIdentityHarness(connection, {
      realSessions: true,
      routerFactories: [probeRouter],
    });
    const verifiedId = await seedUser(connection, { email: 'ana@example.com', password: PASSWORD });
    const unverifiedId = await seedUser(connection, {
      email: 'bob@example.com',
      password: PASSWORD,
      verified: false,
    });

    const results = [];
    for (const email of ['ana@example.com', 'bob@example.com']) {
      const cookies = sessionFrom(await signIn(harness.app, email, PASSWORD));
      results.push(await request(harness.app).get('/probe').set('Cookie', cookieHeader(cookies)));
    }

    const sessions = await connection.pool.query<{ id: string; user_id: string }>(
      'select id, user_id from sessions',
    );
    const sessionOf = (userId: string) => sessions.rows.find((row) => row.user_id === userId)?.id;
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    expect(results[0]?.body).toEqual({
      auth: { userId: verifiedId, sessionId: sessionOf(verifiedId), emailVerified: true },
    });
    expect(results[1]?.body).toEqual({
      auth: { userId: unverifiedId, sessionId: sessionOf(unverifiedId), emailVerified: false },
    });

    const anonymous = await request(harness.app).get('/probe');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ code: 'UNAUTHENTICATED' });
  });

  it('refuses router factories when the identity module is not mounted (no session source)', () => {
    expect(() =>
      createApp({
        env: testEnv(),
        logger: createLogger({ level: 'silent' }),
        routerFactories: [probeRouter],
      }),
    ).toThrow(/identity module/);
  });
});
