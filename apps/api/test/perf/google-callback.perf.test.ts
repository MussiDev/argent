import { createServer, type Server } from 'node:http';
import autocannon from 'autocannon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleOAuthStateRepository } from '../../src/identity/infrastructure/db/drizzle-oauth-state-repository';
import { CryptoTokenGenerator } from '../../src/identity/infrastructure/security/crypto-token-generator';
import { GOOGLE_CALLBACK_PATH } from '../../src/identity/infrastructure/security/google-oidc-identity-provider';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import {
  pkceChallenge,
  startFakeGoogleOidc,
  type FakeGoogleOidc,
} from '../fixtures/fake-google-oidc';
import { createIdentityHarness } from '../helpers/identity-harness';
import { testDatabaseUrl } from '../helpers/test-database';
import { testEnv } from '../helpers/test-env';

/**
 * NFR-01 benchmark: p95 of `GET /auth/google/callback`, measured from the client over loopback, with
 * the fake OIDC server answering the token endpoint after 150 ms (Google's own latency). States are
 * seeded through the repository, because the start rate limit (20 per IP) would otherwise cap the
 * run. Each callback creates a new user, the heaviest path.
 */

const REQUESTS = 200;
const CONNECTIONS = 8;
const TOKEN_LATENCY_MS = 150;
const MAX_P95_MS = 500;
const BINDING_COOKIE = '__Secure-argent_oauth';
const REDIRECT_URI = `${testEnv().API_ORIGIN}${GOOGLE_CALLBACK_PATH}`;

let connection: DatabaseConnection;
let google: FakeGoogleOidc;
let server: Server | undefined;

beforeAll(async () => {
  connection = createDatabase(testDatabaseUrl);
  google = await startFakeGoogleOidc();
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (server) {
      server.close(() => {
        resolve();
      });
    } else {
      resolve();
    }
  });
  await google.close();
  await connection.pool.end();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

interface SeededCallback {
  path: string;
  binding: string;
}

/** One pending OAuth flow per request, stored as `GET /auth/google/start` would store it. */
async function seedCallbacks(now: Date): Promise<SeededCallback[]> {
  const tokens = new CryptoTokenGenerator();
  const states = new DrizzleOAuthStateRepository(connection.db);
  const seeded: SeededCallback[] = [];
  for (let n = 0; n < REQUESTS; n += 1) {
    const [state, binding, nonce, codeVerifier] = Array.from({ length: 4 }, () =>
      tokens.generate(),
    ) as [string, string, string, string];
    await states.create({
      stateHash: tokens.hash(state),
      bindingHash: tokens.hash(binding),
      nonceHash: tokens.hash(nonce),
      codeVerifier,
      timeZone: 'America/Cordoba',
      language: 'es',
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    });
    const code = google.issueCode({
      identity: { sub: `perf-sub-${n}`, email: `perf${n}@gmail.com`, emailVerified: true },
      nonce,
      codeChallenge: pkceChallenge(codeVerifier),
      redirectUri: REDIRECT_URI,
      scope: 'openid email profile',
    });
    const query = new URLSearchParams({
      state,
      code,
      scope: 'email profile openid',
      authuser: '0',
    });
    seeded.push({ path: `/auth/google/callback?${query.toString()}`, binding });
  }
  return seeded;
}

describe('Google callback latency (NFR-01)', () => {
  it('keeps p95 of the callback below 500 ms over 200 requests with 150 ms token latency', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true, google });
    const seeded = await seedCallbacks(harness.clock.now());
    google.setTokenOptions({ delayMs: TOKEN_LATENCY_MS });
    server = createServer(harness.app);
    const target = server;
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const address = target.address();
    if (!address || typeof address !== 'object') throw new Error('server not listening');

    let sent = 0;
    const statuses = new Map<number, number>();
    const latencies: number[] = [];
    await new Promise<void>((resolve, reject) => {
      const instance = autocannon(
        {
          url: `http://127.0.0.1:${address.port}`,
          connections: CONNECTIONS,
          amount: REQUESTS,
          timeout: 30,
          requests: [
            {
              method: 'GET',
              setupRequest: (request) => {
                const next = seeded[sent % REQUESTS];
                sent += 1;
                return {
                  ...request,
                  path: next?.path ?? '/',
                  headers: { cookie: `${BINDING_COOKIE}=${next?.binding ?? ''}` },
                };
              },
            },
          ],
        },
        (error) => {
          if (error) reject(error instanceof Error ? error : new Error(String(error)));
          else resolve();
        },
      );
      instance.on('response', (_client, statusCode, _bytes, responseTime) => {
        statuses.set(statusCode, (statuses.get(statusCode) ?? 0) + 1);
        latencies.push(responseTime);
      });
    });

    expect(Object.fromEntries(statuses)).toEqual({ 302: REQUESTS });
    // Every callback succeeded (a failure is a 302 too): one new user and identity each.
    const identities = await connection.pool.query<{ count: string }>(
      'select count(*) from user_identities',
    );
    expect(Number(identities.rows[0]?.count)).toBe(REQUESTS);
    const failures = harness.lines.filter((line) => line.includes('google sign-in failed'));
    expect(failures).toEqual([]);
    const p95 = percentile(latencies, 95);
    console.info(`google callback p95: ${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(MAX_P95_MS);
  }, 180_000);
});
