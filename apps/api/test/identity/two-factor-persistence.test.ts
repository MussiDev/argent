import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NewSignInChallenge } from '../../src/identity/application/ports/sign-in-challenge-repository';
import { Email } from '../../src/identity/domain/email';
import { DrizzleRecoveryCodeRepository } from '../../src/identity/infrastructure/db/drizzle-recovery-code-repository';
import { DrizzleSignInChallengeRepository } from '../../src/identity/infrastructure/db/drizzle-sign-in-challenge-repository';
import { DrizzleTwoFactorRepository } from '../../src/identity/infrastructure/db/drizzle-two-factor-repository';
import { DrizzleUnitOfWork } from '../../src/identity/infrastructure/db/drizzle-unit-of-work';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { Argon2idPasswordHasher } from '../../src/identity/infrastructure/security/argon2id-password-hasher';
import { CryptoRecoveryCodeGenerator } from '../../src/identity/infrastructure/security/crypto-recovery-code-generator';
import { normalizeRecoveryCode } from '../../src/identity/domain/recovery-code';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { MutableClock } from '../fakes/mutable-clock';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
/** A second pool, as a second API instance would have, for concurrent statements. */
let second: DatabaseConnection;
let users: DrizzleUserRepository;
let twoFactor: DrizzleTwoFactorRepository;
let recoveryCodes: DrizzleRecoveryCodeRepository;
let challenges: DrizzleSignInChallengeRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  second = createDatabase(testDatabaseUrl);
  users = new DrizzleUserRepository(connection.db);
  twoFactor = new DrizzleTwoFactorRepository(connection.db);
  recoveryCodes = new DrizzleRecoveryCodeRepository(connection.db);
  challenges = new DrizzleSignInChallengeRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
  await second.pool.end();
});

const NOW = new Date('2026-09-30T12:00:00.000Z');
const FIVE_MINUTES = 5 * 60 * 1000;

async function createUser(email = 'ana@example.com'): Promise<string> {
  const user = await users.create({
    email: Email.parse(email),
    passwordHash: 'hash',
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone: 'America/Cordoba',
    language: 'es',
  });
  return user.id;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const result = await connection.pool.query<{ n: string }>(sql, params);
  return Number(result.rows[0]?.n);
}

function newChallenge(userId: string, overrides: Partial<NewSignInChallenge> = {}) {
  return {
    tokenHash: 'challenge-hash',
    userId,
    credentialsVersion: 3,
    via: 'password',
    language: 'en',
    expiresAt: new Date(NOW.getTime() + FIVE_MINUTES),
    ...overrides,
  } satisfies NewSignInChallenge;
}

describe('DrizzleTwoFactorRepository', () => {
  it('advanceLastUsedStep accepts a later step once and refuses the same or an earlier step (NFR-03, sad path)', async () => {
    const userId = await createUser();
    await twoFactor.savePending(userId, 'sealed-1');
    expect((await twoFactor.findByUserId(userId))?.lastUsedStep).toBe(0);

    expect(await twoFactor.advanceLastUsedStep(userId, 59_000_000)).toBe(true);
    expect(await twoFactor.advanceLastUsedStep(userId, 59_000_000)).toBe(false);
    expect(await twoFactor.advanceLastUsedStep(userId, 58_999_999)).toBe(false);
    expect((await twoFactor.findByUserId(userId))?.lastUsedStep).toBe(59_000_000);
    expect(await twoFactor.advanceLastUsedStep(userId, 59_000_001)).toBe(true);
    expect((await twoFactor.findByUserId(userId))?.lastUsedStep).toBe(59_000_001);
  });

  it('two concurrent advances of the same step: exactly one wins (R-41, sad path)', async () => {
    const userId = await createUser();
    await twoFactor.savePending(userId, 'sealed-1');
    const other = new DrizzleTwoFactorRepository(second.db);

    const results = await Promise.all([
      twoFactor.advanceLastUsedStep(userId, 100),
      other.advanceLastUsedStep(userId, 100),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('advanceLastUsedStep refuses a user without 2FA (sad path)', async () => {
    const userId = await createUser();

    expect(await twoFactor.advanceLastUsedStep(userId, 1)).toBe(false);
  });

  it('savePending stores a pending secret and replaces it while pending', async () => {
    const userId = await createUser();

    expect(await twoFactor.savePending(userId, 'sealed-1')).toBe(true);
    expect(await twoFactor.findByUserId(userId)).toMatchObject({
      userId,
      secretSealed: 'sealed-1',
      enabledAt: null,
      lastUsedStep: 0,
    });
    expect(await twoFactor.savePending(userId, 'sealed-2')).toBe(true);
    expect((await twoFactor.findByUserId(userId))?.secretSealed).toBe('sealed-2');
    expect(await twoFactor.findByUserId(await createUser('bob@example.com'))).toBeNull();
  });

  it('savePending refuses when 2FA is enabled, and activate refuses when the pending secret changed (sad path)', async () => {
    const userId = await createUser();
    await twoFactor.savePending(userId, 'sealed-1');
    // A setup that ran between verifying `sealed-1` and activating it.
    await twoFactor.savePending(userId, 'sealed-2');

    expect(await twoFactor.activate(userId, 'sealed-1', NOW)).toBe(false);
    expect((await twoFactor.findByUserId(userId))?.enabledAt).toBeNull();

    expect(await twoFactor.activate(userId, 'sealed-2', NOW)).toBe(true);
    expect(await twoFactor.findByUserId(userId)).toMatchObject({
      secretSealed: 'sealed-2',
      enabledAt: NOW,
    });

    expect(await twoFactor.savePending(userId, 'sealed-3')).toBe(false);
    expect(await twoFactor.activate(userId, 'sealed-2', new Date(NOW.getTime() + 1))).toBe(false);
    expect(await twoFactor.findByUserId(userId)).toMatchObject({
      secretSealed: 'sealed-2',
      enabledAt: NOW,
    });
  });

  it('activate refuses a user without a pending setup (sad path)', async () => {
    const userId = await createUser();

    expect(await twoFactor.activate(userId, 'sealed-1', NOW)).toBe(false);
  });

  it('delete removes the settings, and they cascade with the user', async () => {
    const ana = await createUser();
    const bob = await createUser('bob@example.com');
    await twoFactor.savePending(ana, 'sealed-ana');
    await twoFactor.savePending(bob, 'sealed-bob');

    await twoFactor.delete(ana);
    await connection.pool.query('delete from users where id = $1', [bob]);

    expect(await count('select count(*) as n from user_two_factor')).toBe(0);
  });
});

describe('DrizzleRecoveryCodeRepository', () => {
  it('replaceAll stores only Argon2id hashes (no plaintext in the table), and markUsed succeeds once per code (NFR-02, sad path)', async () => {
    const userId = await createUser();
    const hasher = new Argon2idPasswordHasher();
    const codes = new CryptoRecoveryCodeGenerator().generate(10);
    const hashes = await Promise.all(
      codes.map((code) => hasher.hash(normalizeRecoveryCode(code) ?? '')),
    );

    await recoveryCodes.replaceAll(userId, hashes);

    const rows = await connection.pool.query<Record<string, unknown>>(
      'select * from recovery_codes',
    );
    expect(rows.rows).toHaveLength(10);
    const dump = JSON.stringify(rows.rows);
    for (const code of codes) {
      expect(dump).not.toContain(code);
      expect(dump).not.toContain(code.replace('-', ''));
    }
    for (const row of rows.rows) expect(row.code_hash).toMatch(/^\$argon2id\$/);

    const unused = await recoveryCodes.findUnused(userId);
    expect(unused.map((code) => code.codeHash).sort()).toEqual([...hashes].sort());
    const [first] = unused;
    if (!first) throw new Error('no recovery code stored');

    expect(await recoveryCodes.markUsed(first.id, NOW)).toBe(true);
    expect(await recoveryCodes.markUsed(first.id, NOW)).toBe(false);
    expect(await recoveryCodes.countUnused(userId)).toBe(9);
    expect((await recoveryCodes.findUnused(userId)).map((code) => code.id)).not.toContain(first.id);
    const used = await connection.pool.query<{ used_at: Date }>(
      'select used_at from recovery_codes where id = $1',
      [first.id],
    );
    expect(used.rows).toEqual([{ used_at: NOW }]);
  });

  it('two concurrent markUsed of one code: exactly one wins (R-41, sad path)', async () => {
    const userId = await createUser();
    await recoveryCodes.replaceAll(userId, ['h1']);
    const [code] = await recoveryCodes.findUnused(userId);
    const other = new DrizzleRecoveryCodeRepository(second.db);

    const results = await Promise.all([
      recoveryCodes.markUsed(code?.id ?? '', NOW),
      other.markUsed(code?.id ?? '', NOW),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("replaceAll replaces every earlier code of that user only; deleteAll removes only the user's codes", async () => {
    const ana = await createUser();
    const bob = await createUser('bob@example.com');
    await recoveryCodes.replaceAll(ana, ['a1', 'a2']);
    await recoveryCodes.replaceAll(bob, ['b1']);

    await recoveryCodes.replaceAll(ana, ['a3', 'a4', 'a5']);

    expect((await recoveryCodes.findUnused(ana)).map((code) => code.codeHash).sort()).toEqual([
      'a3',
      'a4',
      'a5',
    ]);
    expect(await recoveryCodes.countUnused(bob)).toBe(1);

    await recoveryCodes.deleteAll(ana);
    expect(await recoveryCodes.countUnused(ana)).toBe(0);
    expect(await recoveryCodes.countUnused(bob)).toBe(1);
  });
});

describe('DrizzleUserRepository.bumpCredentialsVersion', () => {
  it('increments the version atomically and returns it (FR-05)', async () => {
    const userId = await createUser();
    const other = await createUser('bob@example.com');

    expect(await users.bumpCredentialsVersion(userId)).toBe(1);
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () => users.bumpCredentialsVersion(userId)),
    );

    expect([...concurrent].sort()).toEqual([2, 3, 4, 5, 6]);
    expect((await users.findById(userId))?.credentialsVersion).toBe(6);
    expect((await users.findById(other))?.credentialsVersion).toBe(0);
  });

  it('rejects for an unknown user (sad path)', async () => {
    await expect(
      users.bumpCredentialsVersion('6f1c1d6e-0000-4000-8000-000000000001'),
    ).rejects.toThrow();
  });
});

describe('DrizzleSignInChallengeRepository', () => {
  it('a challenge is found while live, consume succeeds once, and an expired or consumed challenge is not found (sad path)', async () => {
    const userId = await createUser();
    await challenges.create(newChallenge(userId));

    const live = await challenges.findLive('challenge-hash', NOW);
    expect(live).toMatchObject({ ...newChallenge(userId), attempts: 0 });
    expect(live?.createdAt).toBeInstanceOf(Date);
    const expiry = new Date(NOW.getTime() + FIVE_MINUTES);
    expect(await challenges.findLive('challenge-hash', expiry)).toBeNull();
    expect(await challenges.findLive('unknown-hash', NOW)).toBeNull();

    expect(await challenges.consume('challenge-hash')).toBe(true);
    expect(await challenges.consume('challenge-hash')).toBe(false);
    expect(await challenges.findLive('challenge-hash', NOW)).toBeNull();
  });

  it('lockLive finds a live challenge inside a unit of work, and recordAttempt counts attempts across calls', async () => {
    const userId = await createUser();
    await challenges.create(newChallenge(userId, { via: 'google', language: 'es' }));
    const unitOfWork = new DrizzleUnitOfWork(connection.db, new MutableClock(NOW));

    const attempts = await unitOfWork.run(async ({ signInChallenges }) => {
      const locked = await signInChallenges.lockLive('challenge-hash', NOW);
      expect(locked).toMatchObject({ userId, via: 'google', language: 'es', attempts: 0 });
      expect(
        await signInChallenges.lockLive('challenge-hash', new Date(NOW.getTime() + FIVE_MINUTES)),
      ).toBeNull();
      return [
        await signInChallenges.recordAttempt('challenge-hash'),
        await signInChallenges.recordAttempt('challenge-hash'),
      ];
    });

    expect(attempts).toEqual([1, 2]);
    expect((await challenges.findLive('challenge-hash', NOW))?.attempts).toBe(2);
    await challenges.consume('challenge-hash');
    await expect(challenges.recordAttempt('challenge-hash')).rejects.toThrow();
  });

  it('lockLive holds the row: a second locker waits until the first transaction ends', async () => {
    const userId = await createUser();
    await challenges.create(newChallenge(userId));
    const unitOfWork = new DrizzleUnitOfWork(connection.db, new MutableClock(NOW));
    const events: string[] = [];
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = (): void => undefined;
    const firstLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });

    const holder = unitOfWork.run(async ({ signInChallenges }) => {
      await signInChallenges.lockLive('challenge-hash', NOW);
      locked();
      await held;
      events.push('first consumes');
      await signInChallenges.consume('challenge-hash');
    });
    await firstLocked;
    const waiter = unitOfWork.run(async ({ signInChallenges }) => {
      const found = await signInChallenges.lockLive('challenge-hash', NOW);
      events.push(found ? 'second found it' : 'second found nothing');
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    await Promise.all([holder, waiter]);

    expect(events).toEqual(['first consumes', 'second found nothing']);
  });

  it("deleteForUser deletes only that user's challenges, and purgeExpired only the expired ones", async () => {
    const ana = await createUser();
    const bob = await createUser('bob@example.com');
    await challenges.create(newChallenge(ana, { tokenHash: 'ana-1' }));
    await challenges.create(newChallenge(ana, { tokenHash: 'ana-2' }));
    await challenges.create(newChallenge(bob, { tokenHash: 'bob-live' }));
    await challenges.create(newChallenge(bob, { tokenHash: 'bob-expired', expiresAt: NOW }));

    await challenges.deleteForUser(ana);
    expect(await challenges.purgeExpired(NOW)).toBe(1);

    const left = await connection.pool.query<{ token_hash: string }>(
      'select token_hash from sign_in_challenges order by token_hash',
    );
    expect(left.rows.map((row) => row.token_hash)).toEqual(['bob-live']);
  });
});
