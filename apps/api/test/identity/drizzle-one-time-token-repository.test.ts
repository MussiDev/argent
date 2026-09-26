import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Email } from '../../src/identity/domain/email';
import { DrizzleOneTimeTokenRepository } from '../../src/identity/infrastructure/db/drizzle-one-time-token-repository';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let tokens: DrizzleOneTimeTokenRepository;
let userId: string;

const NOW = new Date('2026-09-26T12:00:00.000Z');
const IN_ONE_HOUR = new Date('2026-09-26T13:00:00.000Z');

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  tokens = new DrizzleOneTimeTokenRepository(connection.db);
});

beforeEach(async () => {
  const user = await new DrizzleUserRepository(connection.db).create({
    email: Email.parse('ana@example.com'),
    passwordHash: 'hash',
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone: 'America/Argentina/Buenos_Aires',
    language: 'es',
  });
  userId = user.id;
});

afterAll(async () => {
  await connection.pool.end();
});

describe('DrizzleOneTimeTokenRepository', () => {
  it('consumes an unused, unexpired token exactly once (NFR-04)', async () => {
    await tokens.create({
      userId,
      purpose: 'email_verification',
      tokenHash: 'h1',
      expiresAt: IN_ONE_HOUR,
    });

    const consumed = await tokens.consume('h1', 'email_verification', NOW);
    expect(consumed).toMatchObject({ userId });
    expect(consumed?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await tokens.consume('h1', 'email_verification', NOW)).toBeNull();
  });

  it('lets only one of two concurrent consumptions win', async () => {
    await tokens.create({
      userId,
      purpose: 'password_reset',
      tokenHash: 'h2',
      expiresAt: IN_ONE_HOUR,
    });

    const results = await Promise.all([
      tokens.consume('h2', 'password_reset', NOW),
      tokens.consume('h2', 'password_reset', NOW),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it('does not consume expired tokens, unknown hashes or another purpose', async () => {
    await tokens.create({ userId, purpose: 'email_verification', tokenHash: 'h3', expiresAt: NOW });

    expect(await tokens.consume('h3', 'email_verification', NOW)).toBeNull();
    expect(await tokens.consume('unknown', 'email_verification', NOW)).toBeNull();

    await tokens.create({
      userId,
      purpose: 'email_verification',
      tokenHash: 'h4',
      expiresAt: IN_ONE_HOUR,
    });
    expect(await tokens.consume('h4', 'password_reset', NOW)).toBeNull();
    expect(await tokens.consume('h4', 'email_verification', NOW)).not.toBeNull();
  });

  it('invalidates the unused tokens of one user and purpose only', async () => {
    await tokens.create({
      userId,
      purpose: 'email_verification',
      tokenHash: 'old',
      expiresAt: IN_ONE_HOUR,
    });
    await tokens.create({
      userId,
      purpose: 'password_reset',
      tokenHash: 'reset',
      expiresAt: IN_ONE_HOUR,
    });

    await tokens.invalidateUnused(userId, 'email_verification', NOW);

    expect(await tokens.consume('old', 'email_verification', NOW)).toBeNull();
    expect(await tokens.consume('reset', 'password_reset', NOW)).not.toBeNull();
  });

  it('stores only the hash it is given', async () => {
    await tokens.create({
      userId,
      purpose: 'email_verification',
      tokenHash: 'only-the-hash',
      expiresAt: IN_ONE_HOUR,
    });

    const rows = await connection.pool.query<{ token_hash: string }>(
      'select token_hash from one_time_tokens',
    );
    expect(rows.rows).toEqual([{ token_hash: 'only-the-hash' }]);
  });
});
