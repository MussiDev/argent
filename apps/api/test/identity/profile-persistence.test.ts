import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Email } from '../../src/identity/domain/email';
import { DrizzleProfileRepository } from '../../src/identity/infrastructure/db/drizzle-profile-repository';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let users: DrizzleUserRepository;
let profiles: DrizzleProfileRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  users = new DrizzleUserRepository(connection.db);
  profiles = new DrizzleProfileRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const UNKNOWN_USER_ID = '00000000-0000-4000-8000-000000000000';

async function createUser(email = 'ana@example.com'): Promise<string> {
  const user = await users.create({
    email: Email.parse(email),
    passwordHash: 'secret-hash',
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone: 'America/Cordoba',
    language: 'es',
  });
  return user.id;
}

async function sqlState(statement: string, params: unknown[]): Promise<string | undefined> {
  try {
    await connection.pool.query(statement, params);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe('DrizzleProfileRepository.findByUserId', () => {
  it('returns a null display name for a user without one, and never the password hash', async () => {
    const userId = await createUser();

    const profile = await profiles.findByUserId(userId);

    expect(profile).toEqual({
      userId,
      email: 'ana@example.com',
      displayName: null,
      hasPassword: true,
      defaultRateType: 'mep',
      displayCurrency: 'ARS',
      timeZone: 'America/Cordoba',
      language: 'es',
    });
    expect(JSON.stringify(profile)).not.toContain('secret-hash');
    expect(profile).not.toHaveProperty('passwordHash');
  });

  it('reports hasPassword false for an account without a password hash, from both read and update', async () => {
    const userId = await createUser();
    await connection.pool.query('update users set password_hash = null where id = $1', [userId]);

    expect((await profiles.findByUserId(userId))?.hasPassword).toBe(false);
    expect((await profiles.update(userId, { displayName: 'Ana' }))?.hasPassword).toBe(false);
  });

  it('resolves null for an unknown user id (sad path)', async () => {
    expect(await profiles.findByUserId(UNKNOWN_USER_ID)).toBeNull();
  });
});

describe('DrizzleProfileRepository.update', () => {
  it('persists the display name and returns the updated profile, leaving the rest untouched', async () => {
    const userId = await createUser();

    const updated = await profiles.update(userId, { displayName: 'Ana Pérez' });

    expect(updated).toEqual({
      userId,
      email: 'ana@example.com',
      displayName: 'Ana Pérez',
      hasPassword: true,
      defaultRateType: 'mep',
      displayCurrency: 'ARS',
      timeZone: 'America/Cordoba',
      language: 'es',
    });
    expect(await profiles.findByUserId(userId)).toEqual(updated);
  });

  it('persists each preference and keeps the other fields', async () => {
    const userId = await createUser();
    await profiles.update(userId, { displayName: 'Ana' });

    expect(await profiles.update(userId, { defaultRateType: 'blue' })).toMatchObject({
      defaultRateType: 'blue',
      displayCurrency: 'ARS',
      timeZone: 'America/Cordoba',
      language: 'es',
      displayName: 'Ana',
    });
    expect(await profiles.update(userId, { displayCurrency: 'USD' })).toMatchObject({
      defaultRateType: 'blue',
      displayCurrency: 'USD',
    });
    expect(await profiles.update(userId, { timeZone: 'Europe/Madrid' })).toMatchObject({
      timeZone: 'Europe/Madrid',
      displayCurrency: 'USD',
    });
    expect(await profiles.update(userId, { language: 'en' })).toMatchObject({
      language: 'en',
      timeZone: 'Europe/Madrid',
      displayName: 'Ana',
    });
  });

  it('applies several fields together in one call', async () => {
    const userId = await createUser();

    const updated = await profiles.update(userId, {
      displayName: 'Ana',
      language: 'en',
      displayCurrency: 'USD',
    });

    expect(updated).toMatchObject({ displayName: 'Ana', language: 'en', displayCurrency: 'USD' });
  });

  it('does not touch other users or the credentials columns', async () => {
    const userId = await createUser();
    const otherId = await createUser('bob@example.com');

    await profiles.update(userId, { displayName: 'Ana' });

    expect((await profiles.findByUserId(otherId))?.displayName).toBeNull();
    const row = await connection.pool.query<{ password_hash: string; credentials_version: number }>(
      'select password_hash, credentials_version from users where id = $1',
      [userId],
    );
    expect(row.rows[0]).toEqual({ password_hash: 'secret-hash', credentials_version: 0 });
  });

  it('resolves null for an unknown user id and writes nothing (error path)', async () => {
    const userId = await createUser();

    expect(await profiles.update(UNKNOWN_USER_ID, { displayName: 'Ghost' })).toBeNull();

    const named = await connection.pool.query('select 1 from users where display_name is not null');
    expect(named.rowCount).toBe(0);
    expect((await profiles.findByUserId(userId))?.displayName).toBeNull();
  });
});

describe('users.display_name check constraint', () => {
  it('rejects an empty and a 51-character display name on update (invalid)', async () => {
    const userId = await createUser();

    for (const name of ['', 'x'.repeat(51)]) {
      expect(
        await sqlState('update users set display_name = $1 where id = $2', [name, userId]),
      ).toBe('23514');
    }
    expect(
      await sqlState('update users set display_name = $1 where id = $2', ['x'.repeat(50), userId]),
    ).toBeUndefined();
  });

  it('rejects an empty and a 51-character display name on insert (invalid)', async () => {
    for (const [index, name] of ['', 'x'.repeat(51)].entries()) {
      expect(
        await sqlState(
          "insert into users (email, password_hash, time_zone, language, display_name) values ($1, 'h', 'UTC', 'es', $2)",
          [`check${index}@example.com`, name],
        ),
      ).toBe('23514');
    }
  });

  it('makes the repository fail on a name that violates it, without a partial write', async () => {
    const userId = await createUser();

    await expect(profiles.update(userId, { displayName: '' })).rejects.toThrow();
    expect((await profiles.findByUserId(userId))?.displayName).toBeNull();
  });
});
