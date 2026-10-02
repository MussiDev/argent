import { describe, expect, it } from 'vitest';
import { GetProfile } from '../../src/identity/application/get-profile';
import type {
  Profile,
  ProfileChanges,
  ProfileRepository,
} from '../../src/identity/application/ports/profile-repository';
import { UpdateProfile } from '../../src/identity/application/update-profile';
import { EmailChangeNotAllowed, Unauthenticated } from '../../src/identity/domain/errors';

const USER_ID = '00000000-0000-4000-8000-000000000001';

const stored: Profile = {
  userId: USER_ID,
  email: 'ana@example.com',
  displayName: null,
  hasPassword: true,
  defaultRateType: 'mep',
  displayCurrency: 'ARS',
  timeZone: 'America/Cordoba',
  language: 'es',
};

interface FakeProfiles extends ProfileRepository {
  reads: string[];
  updates: { userId: string; changes: ProfileChanges }[];
}

function fakeProfiles(current: Profile | null = stored): FakeProfiles {
  const fake: FakeProfiles = {
    reads: [],
    updates: [],
    findByUserId: (userId) => {
      fake.reads.push(userId);
      return Promise.resolve(current);
    },
    update: (userId, changes) => {
      fake.updates.push({ userId, changes });
      return Promise.resolve(current ? { ...current, ...changes } : null);
    },
  };
  return fake;
}

const twoFactor = (enabled: boolean) => ({ execute: () => Promise.resolve({ enabled }) });

describe('GetProfile', () => {
  it('returns the view of the response schema, with a null display name as null', async () => {
    const view = await new GetProfile({
      profiles: fakeProfiles(),
      twoFactorStatus: twoFactor(true),
    }).execute(USER_ID);

    expect(view).toEqual({
      displayName: null,
      email: 'ana@example.com',
      twoFactorEnabled: true,
      deletionReauth: 'password',
      preferences: {
        defaultRateType: 'mep',
        displayCurrency: 'ARS',
        timeZone: 'America/Cordoba',
        language: 'es',
      },
    });
  });

  it('asks for Google re-authentication when the account has no password', async () => {
    const view = await new GetProfile({
      profiles: fakeProfiles({ ...stored, hasPassword: false }),
      twoFactorStatus: twoFactor(false),
    }).execute(USER_ID);

    expect(view.deletionReauth).toBe('google');
  });

  it('raises Unauthenticated for a user that no longer exists (sad path)', async () => {
    const useCase = new GetProfile({
      profiles: fakeProfiles(null),
      twoFactorStatus: twoFactor(false),
    });

    await expect(useCase.execute(USER_ID)).rejects.toBeInstanceOf(Unauthenticated);
  });

  it('fails as a whole when the 2FA status lookup fails (error path)', async () => {
    const useCase = new GetProfile({
      profiles: fakeProfiles(),
      twoFactorStatus: { execute: () => Promise.reject(new Error('db down')) },
    });

    await expect(useCase.execute(USER_ID)).rejects.toThrow('db down');
  });
});

describe('UpdateProfile', () => {
  it('carries deletionReauth in the updated view, google for an account without a password', async () => {
    const profiles = fakeProfiles({ ...stored, hasPassword: false });
    const view = await new UpdateProfile({
      profiles,
      twoFactorStatus: twoFactor(false),
    }).execute(USER_ID, { language: 'en' });

    expect(view.deletionReauth).toBe('google');
  });

  function build(current: Profile | null = stored) {
    const profiles = fakeProfiles(current);
    return {
      profiles,
      useCase: new UpdateProfile({ profiles, twoFactorStatus: twoFactor(false) }),
    };
  }

  it('writes every given field in one update call and returns the updated view', async () => {
    const { profiles, useCase } = build();

    const view = await useCase.execute(USER_ID, {
      displayName: 'Ana',
      defaultRateType: 'blue',
      displayCurrency: 'USD',
      timeZone: 'Europe/Madrid',
      language: 'en',
    });

    expect(profiles.updates).toEqual([
      {
        userId: USER_ID,
        changes: {
          displayName: 'Ana',
          defaultRateType: 'blue',
          displayCurrency: 'USD',
          timeZone: 'Europe/Madrid',
          language: 'en',
        },
      },
    ]);
    expect(view).toEqual({
      displayName: 'Ana',
      email: 'ana@example.com',
      twoFactorEnabled: false,
      deletionReauth: 'password',
      preferences: {
        defaultRateType: 'blue',
        displayCurrency: 'USD',
        timeZone: 'Europe/Madrid',
        language: 'en',
      },
    });
  });

  it('does not read the account when the request carries no email', async () => {
    const { profiles, useCase } = build();

    await useCase.execute(USER_ID, { language: 'en' });

    expect(profiles.reads).toEqual([]);
  });

  it('ignores an email equal to the current one, in any case, and never writes it', async () => {
    const { profiles, useCase } = build();

    await useCase.execute(USER_ID, { email: ' ANA@Example.COM ', displayName: 'Ana' });

    expect(profiles.updates).toEqual([{ userId: USER_ID, changes: { displayName: 'Ana' } }]);
  });

  it('raises EmailChangeNotAllowed for a different email and writes nothing (sad path)', async () => {
    const { profiles, useCase } = build();

    await expect(
      useCase.execute(USER_ID, { email: 'other@example.com', displayName: 'Ana' }),
    ).rejects.toBeInstanceOf(EmailChangeNotAllowed);
    expect(profiles.updates).toEqual([]);
  });

  it('raises EmailChangeNotAllowed for an email that does not parse (sad path)', async () => {
    const { profiles, useCase } = build();

    await expect(
      useCase.execute(USER_ID, { email: 'not-an-email', language: 'en' }),
    ).rejects.toBeInstanceOf(EmailChangeNotAllowed);
    expect(profiles.updates).toEqual([]);
  });

  it('raises Unauthenticated when the user no longer exists, with or without an email (sad path)', async () => {
    const { useCase } = build(null);

    await expect(useCase.execute(USER_ID, { language: 'en' })).rejects.toBeInstanceOf(
      Unauthenticated,
    );
    await expect(
      useCase.execute(USER_ID, { email: 'ana@example.com', language: 'en' }),
    ).rejects.toBeInstanceOf(Unauthenticated);
  });

  it('fails as a whole when the database write fails (error path)', async () => {
    const profiles = fakeProfiles();
    profiles.update = () => Promise.reject(new Error('db down'));
    const useCase = new UpdateProfile({ profiles, twoFactorStatus: twoFactor(false) });

    await expect(useCase.execute(USER_ID, { language: 'en' })).rejects.toThrow('db down');
  });
});
