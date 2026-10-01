import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleRecoveryCodeRepository } from '../../src/identity/infrastructure/db/drizzle-recovery-code-repository';
import { DrizzleSignInChallengeRepository } from '../../src/identity/infrastructure/db/drizzle-sign-in-challenge-repository';
import { CryptoTokenGenerator } from '../../src/identity/infrastructure/security/crypto-token-generator';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { createIdentityHarness } from '../helpers/identity-harness';
import { seedUser } from '../helpers/session-client';
import { testDatabaseUrl } from '../helpers/test-database';
import { seedTwoFactor, verifySecondFactor } from '../helpers/two-factor-client';

/**
 * Verify with a valid recovery code that matches the last of the user's 10 unused codes: the worst
 * successful case, 10 sequential Argon2id checks (threat R-45). Each request is a different user,
 * so the per-user limits never refuse; challenges are seeded through the repository, as a password
 * sign-in would create them, so the run measures only the second step.
 */

const REQUESTS = 50;
const MAX_P95_MS = 1000;
const PASSWORD = 'a long enough passphrase';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.POSITIVE_INFINITY;
}

describe('second-factor verify latency (NFR-02, threat R-45)', () => {
  it('keeps p95 of a verify with the last of 10 recovery codes below 1000 ms over 50 requests', async () => {
    const harness = createIdentityHarness(connection, { realSessions: true });
    const tokens = new CryptoTokenGenerator();
    const challenges = new DrizzleSignInChallengeRepository(connection.db);
    const recoveryCodeRows = new DrizzleRecoveryCodeRepository(connection.db);
    const seeded: { token: string; code: string }[] = [];
    for (let n = 0; n < REQUESTS; n += 1) {
      const userId = await seedUser(connection, {
        email: `perf${n}@example.com`,
        password: PASSWORD,
      });
      const { codeForHash } = await seedTwoFactor(connection, userId, harness.clock);
      const version = await connection.pool.query<{ credentials_version: number }>(
        'select credentials_version from users where id = $1',
        [userId],
      );
      const token = tokens.generate();
      await challenges.create({
        tokenHash: tokens.hash(token),
        userId,
        credentialsVersion: version.rows[0]?.credentials_version ?? 0,
        via: 'password',
        language: 'es',
        expiresAt: new Date(harness.clock.now().getTime() + 5 * 60 * 1000),
      });
      // The code of the last row the check will read: all 10 hashes are verified (worst case).
      const unused = await recoveryCodeRows.findUnused(userId);
      expect(unused).toHaveLength(10);
      const last = codeForHash.get(unused[unused.length - 1]?.codeHash ?? '');
      if (!last) throw new Error('no code for the last unused row');
      seeded.push({ token, code: last });
    }

    const latencies: number[] = [];
    const statuses = new Map<number, number>();
    for (const { token, code } of seeded) {
      const started = performance.now();
      const response = await verifySecondFactor(harness.app, token, code);
      latencies.push(performance.now() - started);
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
    }

    expect(Object.fromEntries(statuses)).toEqual({ 200: REQUESTS });
    const p95 = percentile(latencies, 95);
    console.info(`second-factor verify (last of 10 recovery codes) p95: ${p95.toFixed(1)} ms`);
    expect(p95).toBeLessThan(MAX_P95_MS);
  }, 180_000);
});
