import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Email } from '../../src/identity/domain/email';
import { DrizzleSessionRepository } from '../../src/identity/infrastructure/db/drizzle-session-repository';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let sessions: DrizzleSessionRepository;
let userId: string;
let otherUserId: string;

const T0 = new Date('2026-09-26T12:00:00.000Z');
const T1 = new Date('2026-09-26T12:05:00.000Z');
const T2 = new Date('2026-09-26T12:10:00.000Z');

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  sessions = new DrizzleSessionRepository(connection.db);
});

beforeEach(async () => {
  const users = new DrizzleUserRepository(connection.db);
  const base = {
    passwordHash: 'hash',
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone: 'America/Argentina/Buenos_Aires',
    language: 'es',
  } as const;
  userId = (await users.create({ ...base, email: Email.parse('ana@example.com') })).id;
  otherUserId = (await users.create({ ...base, email: Email.parse('bob@example.com') })).id;
});

afterAll(async () => {
  await connection.pool.end();
});

describe('DrizzleSessionRepository', () => {
  it('creates a session and finds it by id and by refresh token hash', async () => {
    const familyId = randomUUID();
    const created = await sessions.create({
      userId,
      familyId,
      refreshTokenHash: 'rt1',
      credentialsVersion: 3,
      lastUsedAt: T0,
    });

    expect(created).toMatchObject({
      userId,
      familyId,
      refreshTokenHash: 'rt1',
      credentialsVersion: 3,
      lastUsedAt: T0,
      revokedAt: null,
      replacedBy: null,
    });
    expect(await sessions.findById(created.id)).toEqual(created);
    expect(await sessions.findByRefreshTokenHash('rt1')).toEqual(created);
    expect(await sessions.findByRefreshTokenHash('unknown')).toBeNull();
  });

  it('records the replacement when a session is rotated', async () => {
    const familyId = randomUUID();
    const old = await sessions.create({
      userId,
      familyId,
      refreshTokenHash: 'a',
      lastUsedAt: T0,
      credentialsVersion: 0,
    });
    const next = await sessions.create({
      userId,
      familyId,
      refreshTokenHash: 'b',
      lastUsedAt: T1,
      credentialsVersion: 0,
    });

    expect(await sessions.markReplaced(old.id, next.id, T1)).toBe(true);

    expect(await sessions.findById(old.id)).toMatchObject({ revokedAt: T1, replacedBy: next.id });
    expect(await sessions.findById(next.id)).toMatchObject({ revokedAt: null });
  });

  it('claims a rotation only once: replacing an already revoked session changes nothing (R-15)', async () => {
    const familyId = randomUUID();
    const old = await sessions.create({
      userId,
      familyId,
      refreshTokenHash: 'r1',
      lastUsedAt: T0,
      credentialsVersion: 0,
    });
    const first = await sessions.create({
      userId,
      familyId,
      refreshTokenHash: 'r2',
      credentialsVersion: 0,
      lastUsedAt: T1,
    });
    const second = await sessions.create({
      userId,
      familyId,
      refreshTokenHash: 'r3',
      credentialsVersion: 0,
      lastUsedAt: T1,
    });

    expect(await sessions.markReplaced(old.id, first.id, T1)).toBe(true);
    expect(await sessions.markReplaced(old.id, second.id, T2)).toBe(false);

    expect(await sessions.findById(old.id)).toMatchObject({ revokedAt: T1, replacedBy: first.id });
  });

  it('of two overlapping rotation transactions, the one that waited for the row lock loses its claim (R-15)', async () => {
    const familyId = randomUUID();
    const old = await sessions.create({
      userId,
      familyId,
      refreshTokenHash: 'x1',
      lastUsedAt: T0,
      credentialsVersion: 0,
    });
    let claimed!: () => void;
    const firstClaimed = new Promise<void>((resolve) => (claimed = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const first = connection.db.transaction(async (tx) => {
      const repository = new DrizzleSessionRepository(tx);
      const successor = await repository.create({
        userId,
        familyId,
        refreshTokenHash: 'x2',
        credentialsVersion: 0,
        lastUsedAt: T1,
      });
      const won = await repository.markReplaced(old.id, successor.id, T1);
      claimed();
      // Holds the row lock until the second transaction is blocked on it.
      await gate;
      return won;
    });
    await firstClaimed;
    const second = connection.db.transaction(async (tx) => {
      const repository = new DrizzleSessionRepository(tx);
      const successor = await repository.create({
        userId,
        familyId,
        refreshTokenHash: 'x3',
        credentialsVersion: 0,
        lastUsedAt: T1,
      });
      return repository.markReplaced(old.id, successor.id, T2);
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();

    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(await sessions.findById(old.id)).toMatchObject({ revokedAt: T1 });
  });

  it('starts a new family, named after the session, when no family is given', async () => {
    const created = await sessions.create({
      userId,
      refreshTokenHash: 'n1',
      lastUsedAt: T0,
      credentialsVersion: 0,
    });

    expect(created.familyId).toBe(created.id);
  });

  it('keeps the first revocation time when revoking twice', async () => {
    const session = await sessions.create({
      userId,
      familyId: randomUUID(),
      refreshTokenHash: 'c',
      credentialsVersion: 0,
      lastUsedAt: T0,
    });

    await sessions.revoke(session.id, T1);
    await sessions.revoke(session.id, T2);

    expect((await sessions.findById(session.id))?.revokedAt).toEqual(T1);
  });

  it('revokes a whole family and every session of a user, leaving others intact', async () => {
    const family = randomUUID();
    const a = await sessions.create({
      userId,
      familyId: family,
      refreshTokenHash: 'f1',
      credentialsVersion: 0,
      lastUsedAt: T0,
    });
    const b = await sessions.create({
      userId,
      familyId: family,
      refreshTokenHash: 'f2',
      credentialsVersion: 0,
      lastUsedAt: T0,
    });
    const c = await sessions.create({
      userId,
      familyId: randomUUID(),
      refreshTokenHash: 'f3',
      credentialsVersion: 0,
      lastUsedAt: T0,
    });
    const other = await sessions.create({
      userId: otherUserId,
      familyId: randomUUID(),
      refreshTokenHash: 'o1',
      credentialsVersion: 0,
      lastUsedAt: T0,
    });

    await sessions.revokeFamily(family, T1);
    expect((await sessions.findById(a.id))?.revokedAt).toEqual(T1);
    expect((await sessions.findById(b.id))?.revokedAt).toEqual(T1);
    expect((await sessions.findById(c.id))?.revokedAt).toBeNull();

    await sessions.revokeAllForUser(userId, T2);
    expect((await sessions.findById(a.id))?.revokedAt).toEqual(T1);
    expect((await sessions.findById(c.id))?.revokedAt).toEqual(T2);
    expect((await sessions.findById(other.id))?.revokedAt).toBeNull();
  });
});
