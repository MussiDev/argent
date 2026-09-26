import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NewUser } from '../../src/identity/application/ports/user-repository';
import { Email } from '../../src/identity/domain/email';
import { DuplicateEmail } from '../../src/identity/domain/errors';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let users: DrizzleUserRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  users = new DrizzleUserRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

function newUser(overrides: Partial<NewUser> = {}): NewUser {
  return {
    email: Email.parse('ana@example.com'),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone: 'America/Cordoba',
    language: 'es',
    ...overrides,
  };
}

describe('DrizzleUserRepository', () => {
  it('creates an unverified user with the given defaults', async () => {
    const created = await users.create(newUser());

    expect(created).toMatchObject({
      email: 'ana@example.com',
      emailVerifiedAt: null,
      defaultRateType: 'mep',
      displayCurrency: 'ARS',
      timeZone: 'America/Cordoba',
      language: 'es',
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it('raises DuplicateEmail instead of a raw SQL error for a duplicate email', async () => {
    await users.create(newUser());

    const second = users.create(newUser({ email: Email.parse('  ANA@Example.com ') }));

    await expect(second).rejects.toBeInstanceOf(DuplicateEmail);
    await expect(second).rejects.not.toHaveProperty('code', '23505');
  });

  it('finds users by email and by id', async () => {
    const created = await users.create(newUser());

    expect(await users.findByEmail(Email.parse('Ana@Example.com'))).toEqual(created);
    expect(await users.findById(created.id)).toEqual(created);
    expect(await users.findByEmail(Email.parse('nobody@example.com'))).toBeNull();
    expect(await users.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('marks the email verified', async () => {
    const created = await users.create(newUser());
    const verifiedAt = new Date('2026-09-26T12:00:00.000Z');

    await users.markEmailVerified(created.id, verifiedAt);

    expect(await users.findById(created.id)).toMatchObject({ emailVerifiedAt: verifiedAt });
  });

  it('starts at credentials version 0; a password change bumps it and records when', async () => {
    const created = await users.create(newUser());
    expect(created).toMatchObject({ credentialsVersion: 0, passwordChangedAt: null });
    const first = new Date('2026-09-26T12:00:00.000Z');
    const second = new Date('2026-09-26T13:00:00.000Z');

    await users.changePassword(created.id, 'new-hash', first);
    expect(await users.findById(created.id)).toMatchObject({
      passwordHash: 'new-hash',
      credentialsVersion: 1,
      passwordChangedAt: first,
    });

    await users.changePassword(created.id, 'newer-hash', second);
    expect(await users.findById(created.id)).toMatchObject({
      passwordHash: 'newer-hash',
      credentialsVersion: 2,
      passwordChangedAt: second,
    });
  });
});
