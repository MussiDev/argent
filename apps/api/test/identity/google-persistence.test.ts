import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NewOAuthState } from '../../src/identity/application/ports/oauth-state-repository';
import type { NewUser } from '../../src/identity/application/ports/user-repository';
import { Email } from '../../src/identity/domain/email';
import { IdentityAlreadyLinked } from '../../src/identity/domain/errors';
import { DrizzleOAuthStateRepository } from '../../src/identity/infrastructure/db/drizzle-oauth-state-repository';
import { DrizzleUserIdentityRepository } from '../../src/identity/infrastructure/db/drizzle-user-identity-repository';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;
let users: DrizzleUserRepository;
let identities: DrizzleUserIdentityRepository;
let oauthStates: DrizzleOAuthStateRepository;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
  users = new DrizzleUserRepository(connection.db);
  identities = new DrizzleUserIdentityRepository(connection.db);
  oauthStates = new DrizzleOAuthStateRepository(connection.db);
});

afterAll(async () => {
  await connection.pool.end();
});

const NOW = new Date('2026-09-28T12:00:00.000Z');
const TEN_MINUTES = 10 * 60 * 1000;

function newUser(email: string, overrides: Partial<NewUser> = {}): NewUser {
  return {
    email: Email.parse(email),
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone: 'America/Cordoba',
    language: 'es',
    ...overrides,
  };
}

function newState(overrides: Partial<NewOAuthState> = {}): NewOAuthState {
  return {
    stateHash: 'state-hash',
    bindingHash: 'binding-hash',
    nonceHash: 'nonce-hash',
    codeVerifier: 'code-verifier',
    timeZone: 'America/Cordoba',
    language: 'en',
    expiresAt: new Date(NOW.getTime() + TEN_MINUTES),
    ...overrides,
  };
}

async function identityRows(): Promise<
  { user_id: string; provider: string; subject: string; email_authoritative: boolean }[]
> {
  const result = await connection.pool.query<{
    user_id: string;
    provider: string;
    subject: string;
    email_authoritative: boolean;
  }>(
    'select user_id, provider, subject, email_authoritative from user_identities order by subject',
  );
  return result.rows;
}

async function displayNameOf(userId: string): Promise<string | null> {
  const result = await connection.pool.query<{ display_name: string | null }>(
    'select display_name from users where id = $1',
    [userId],
  );
  return result.rows[0]?.display_name ?? null;
}

describe('DrizzleUserRepository for Google accounts', () => {
  it('creates a user without a password and with emailVerifiedAt set (FR-01, FR-03)', async () => {
    const created = await users.create(
      newUser('ana@gmail.com', { passwordHash: null, emailVerifiedAt: NOW }),
    );

    expect(created).toMatchObject({
      email: 'ana@gmail.com',
      passwordHash: null,
      emailVerifiedAt: NOW,
      credentialsVersion: 0,
    });
    expect(await users.findById(created.id)).toEqual(created);
  });

  it('supersedeUnverified clears the password, bumps the credentials version and marks the email verified (FR-05)', async () => {
    const created = await users.create(newUser('ana@gmail.com'));

    const superseded = await users.supersedeUnverified(created.id, NOW, null);

    expect(superseded).toMatchObject({
      id: created.id,
      passwordHash: null,
      credentialsVersion: 1,
      passwordChangedAt: NOW,
      emailVerifiedAt: NOW,
    });
    expect(await users.findById(created.id)).toEqual(superseded);
  });

  it('supersedeUnverified returns null and changes nothing on an already verified user (sad path)', async () => {
    const created = await users.create(newUser('ana@gmail.com', { displayName: 'Typed Name' }));
    await users.markEmailVerified(created.id, new Date('2026-09-27T00:00:00.000Z'));
    const before = await users.findById(created.id);

    expect(await users.supersedeUnverified(created.id, NOW, 'Ana Google')).toBeNull();
    expect(await users.findById(created.id)).toEqual(before);
    expect(await displayNameOf(created.id)).toBe('Typed Name');
  });

  it('supersedeUnverified sets the display name in the same statement that removes the password (FR-07)', async () => {
    const created = await users.create(newUser('ana@gmail.com', { displayName: 'Typed Name' }));

    const superseded = await users.supersedeUnverified(created.id, NOW, 'Ana Google');

    expect(superseded).toMatchObject({ id: created.id, passwordHash: null });
    expect(await displayNameOf(created.id)).toBe('Ana Google');
  });

  it('supersedeUnverified replaces the typed display name with null when Google sent none (FR-07)', async () => {
    const created = await users.create(newUser('ana@gmail.com', { displayName: 'Typed Name' }));

    await users.supersedeUnverified(created.id, NOW, null);

    expect(await displayNameOf(created.id)).toBeNull();
  });
});

describe('DrizzleUserIdentityRepository', () => {
  it('links a Google identity with its emailAuthoritative flag and finds its user, read with the link (FR-02, FR-04)', async () => {
    const ana = await users.create(newUser('ana@gmail.com'));
    const bob = await users.create(newUser('bob@example.com'));

    await identities.link({
      userId: ana.id,
      provider: 'google',
      subject: 'sub-ana',
      emailAuthoritative: true,
    });
    await identities.link({
      userId: bob.id,
      provider: 'google',
      subject: 'sub-bob',
      emailAuthoritative: false,
    });

    expect(await identities.findUserByProviderSubject('google', 'sub-ana')).toEqual(ana);
    expect(await identities.findUserByProviderSubject('google', 'sub-bob')).toEqual(bob);
    expect(await identities.findUserByProviderSubject('google', 'sub-unknown')).toBeNull();
    const carl = await users.create(newUser('carl@gmail.com'));
    expect(await identities.hasProviderIdentity(ana.id, 'google')).toBe(true);
    expect(await identities.hasProviderIdentity(carl.id, 'google')).toBe(false);
    expect(await identityRows()).toEqual([
      { user_id: ana.id, provider: 'google', subject: 'sub-ana', email_authoritative: true },
      { user_id: bob.id, provider: 'google', subject: 'sub-bob', email_authoritative: false },
    ]);
  });

  it('rejects a second link of the same subject, or a second Google identity for one user, with IdentityAlreadyLinked (sad path)', async () => {
    const ana = await users.create(newUser('ana@gmail.com'));
    const bob = await users.create(newUser('bob@gmail.com'));
    await identities.link({
      userId: ana.id,
      provider: 'google',
      subject: 'sub-ana',
      emailAuthoritative: true,
    });

    const sameSubject = identities.link({
      userId: bob.id,
      provider: 'google',
      subject: 'sub-ana',
      emailAuthoritative: true,
    });
    const secondForUser = identities.link({
      userId: ana.id,
      provider: 'google',
      subject: 'sub-other',
      emailAuthoritative: true,
    });

    await expect(sameSubject).rejects.toBeInstanceOf(IdentityAlreadyLinked);
    await expect(sameSubject).rejects.not.toHaveProperty('code', '23505');
    await expect(secondForUser).rejects.toBeInstanceOf(IdentityAlreadyLinked);
    expect(await identityRows()).toEqual([
      { user_id: ana.id, provider: 'google', subject: 'sub-ana', email_authoritative: true },
    ]);
  });

  it("deleteNonAuthoritativeForUser deletes only that user's identities with email_authoritative = false (FR-07)", async () => {
    const ana = await users.create(newUser('ana@gmail.com'));
    const bob = await users.create(newUser('bob@example.com'));
    const carla = await users.create(newUser('carla@example.com'));
    await identities.link({
      userId: ana.id,
      provider: 'google',
      subject: 'sub-ana',
      emailAuthoritative: true,
    });
    await identities.link({
      userId: bob.id,
      provider: 'google',
      subject: 'sub-bob',
      emailAuthoritative: false,
    });
    await identities.link({
      userId: carla.id,
      provider: 'google',
      subject: 'sub-carla',
      emailAuthoritative: false,
    });

    await identities.deleteNonAuthoritativeForUser(ana.id);
    await identities.deleteNonAuthoritativeForUser(bob.id);

    expect((await identityRows()).map((row) => row.subject)).toEqual(['sub-ana', 'sub-carla']);
  });
});

describe('DrizzleOAuthStateRepository', () => {
  it('consume returns the state once; a second consume returns null (sad path)', async () => {
    await oauthStates.create(newState());

    const consumed = await oauthStates.consume('state-hash', 'binding-hash', NOW);

    expect(consumed).toMatchObject(newState());
    expect(consumed?.createdAt).toBeInstanceOf(Date);
    expect(await oauthStates.consume('state-hash', 'binding-hash', NOW)).toBeNull();
  });

  it('consume with a wrong binding hash returns null and leaves the state for its own browser (sad path)', async () => {
    await oauthStates.create(newState());

    expect(await oauthStates.consume('state-hash', 'other-binding', NOW)).toBeNull();
    expect(await oauthStates.consume('state-hash', 'binding-hash', NOW)).not.toBeNull();
  });

  it('consume of an expired state returns null (sad path)', async () => {
    await oauthStates.create(newState({ expiresAt: NOW }));

    expect(await oauthStates.consume('state-hash', 'binding-hash', NOW)).toBeNull();
    expect(
      await oauthStates.consume('state-hash', 'binding-hash', new Date(NOW.getTime() - 1)),
    ).not.toBeNull();
  });
});
