import { describe, expect, it, vi } from 'vitest';
import { CompleteDeletionReauth } from '../../src/identity/application/complete-deletion-reauth';
import { CompleteGoogleSignIn } from '../../src/identity/application/complete-google-sign-in';
import { DELETION_GRANT_TTL_MS } from '../../src/identity/application/delete-user';
import type { CreateSignInChallenge } from '../../src/identity/application/create-sign-in-challenge';
import type { DeletionGrant } from '../../src/identity/application/ports/deletion-grant-repository';
import {
  GoogleSignInFailed,
  type GoogleClaims,
  type GoogleIdentityProvider,
} from '../../src/identity/application/ports/google-identity-provider';
import type {
  OAuthState,
  OAuthStateRepository,
} from '../../src/identity/application/ports/oauth-state-repository';
import type { SessionRepository } from '../../src/identity/application/ports/session-repository';
import type { UnitOfWork } from '../../src/identity/application/ports/unit-of-work';
import type { UserIdentityRepository } from '../../src/identity/application/ports/user-identity-repository';
import type { User } from '../../src/identity/application/ports/user-repository';
import type { StartSession } from '../../src/identity/application/start-session';
import { CryptoTokenGenerator } from '../../src/identity/infrastructure/security/crypto-token-generator';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const CREATED_AT = new Date('2026-10-02T11:59:00.000Z');
const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
const FAMILY_ID = '00000000-0000-4000-8000-0000000000f1';
const tokens = new CryptoTokenGenerator();

const user: User = {
  id: USER_ID,
  email: 'gina@gmail.com',
  passwordHash: null,
  emailVerifiedAt: NOW,
  defaultRateType: 'oficial',
  displayCurrency: 'ARS',
  timeZone: 'America/Cordoba',
  language: 'en',
  createdAt: NOW,
  credentialsVersion: 4,
  passwordChangedAt: null,
};

const claims = (overrides: Partial<GoogleClaims> = {}): GoogleClaims => ({
  subject: 'g-sub',
  email: 'gina@gmail.com',
  emailVerified: true,
  hostedDomain: null,
  name: null,
  authTime: NOW_SECONDS,
  ...overrides,
});

const deleteState = (overrides: Partial<OAuthState> = {}): OAuthState => ({
  stateHash: 'state-hash',
  bindingHash: 'binding-hash',
  nonceHash: 'nonce-hash',
  codeVerifier: 'verifier',
  timeZone: 'America/Cordoba',
  language: 'en',
  purpose: 'delete_account',
  userId: USER_ID,
  sessionFamilyId: FAMILY_ID,
  createdAt: CREATED_AT,
  expiresAt: new Date(NOW.getTime() + 60_000),
  ...overrides,
});

const signInState = (): OAuthState =>
  deleteState({ purpose: 'sign_in', userId: null, sessionFamilyId: null });

interface World {
  linkedUser: User | null;
  familyLive: boolean;
  grants: DeletionGrant[];
}

function newWorld(overrides: Partial<World> = {}): World {
  return { linkedUser: user, familyLive: true, grants: [], ...overrides };
}

function deletionReauth(world: World): CompleteDeletionReauth {
  const identities = {
    findUserByProviderSubject: () => Promise.resolve(world.linkedUser),
  } as unknown as UserIdentityRepository;
  const sessions = {
    isFamilyLive: () => Promise.resolve(world.familyLive),
  } as unknown as SessionRepository;
  return new CompleteDeletionReauth({
    identities,
    sessions,
    deletionGrants: {
      replace: (grant: DeletionGrant) => {
        world.grants.push(grant);
        return Promise.resolve();
      },
      findLive: () => Promise.resolve(null),
    },
    tokenGenerator: tokens,
    clock: { now: () => NOW },
  });
}

describe('CompleteDeletionReauth', () => {
  it('issues a grant bound to the user, the family and the credentials version, storing only the hash (AC-06)', async () => {
    const world = newWorld();

    const result = await deletionReauth(world).execute({
      pending: deleteState(),
      claims: claims(),
    });

    expect(result.outcome).toBe('issued');
    const token = result.outcome === 'issued' ? result.token : '';
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(world.grants).toEqual([
      {
        tokenHash: tokens.hash(token),
        userId: USER_ID,
        sessionFamilyId: FAMILY_ID,
        credentialsVersion: 4,
        expiresAt: new Date(NOW.getTime() + DELETION_GRANT_TTL_MS),
      },
    ]);
    expect(JSON.stringify(world.grants)).not.toContain(token);
  });

  it.each([
    [
      'exactly one minute before the state was created',
      Math.floor(CREATED_AT.getTime() / 1000) - 60,
    ],
    ['exactly one minute after now', NOW_SECONDS + 60],
  ])('accepts an auth_time %s (NFR-04)', async (_label, authTime) => {
    const world = newWorld();

    const result = await deletionReauth(world).execute({
      pending: deleteState(),
      claims: claims({ authTime }),
    });

    expect(result.outcome).toBe('issued');
  });

  it('accepts an ID token without auth_time when the state is fresh (NFR-04)', async () => {
    const world = newWorld();

    const result = await deletionReauth(world).execute({
      pending: deleteState(),
      claims: claims({ authTime: null }),
    });

    expect(result.outcome).toBe('issued');
    expect(world.grants).toHaveLength(1);
  });

  it.each([
    ['older than the state by more than a minute', Math.floor(CREATED_AT.getTime() / 1000) - 61],
    ['more than a minute in the future', NOW_SECONDS + 61],
  ])('refuses an auth_time %s and stores no grant (sad path)', async (_label, authTime) => {
    const world = newWorld();

    const result = await deletionReauth(world).execute({
      pending: deleteState(),
      claims: claims({ authTime }),
    });

    expect(result).toEqual({ outcome: 'refused', reason: 'auth_time_out_of_window' });
    expect(world.grants).toEqual([]);
  });

  it('refuses a Google account that is not linked to anyone, or linked to another user (sad path)', async () => {
    for (const linkedUser of [null, { ...user, id: OTHER_USER_ID }]) {
      const world = newWorld({ linkedUser });

      const result = await deletionReauth(world).execute({
        pending: deleteState(),
        claims: claims(),
      });

      expect(result).toEqual({ outcome: 'refused', reason: 'another_identity' });
      expect(world.grants).toEqual([]);
    }
  });

  it('refuses when the session family was revoked meanwhile (sad path)', async () => {
    const world = newWorld({ familyLive: false });

    const result = await deletionReauth(world).execute({
      pending: deleteState(),
      claims: claims(),
    });

    expect(result).toEqual({ outcome: 'refused', reason: 'session_family_revoked' });
    expect(world.grants).toEqual([]);
  });

  it('refuses a state that is not a bound delete_account state (sad path)', async () => {
    const world = newWorld();

    const result = await deletionReauth(world).execute({
      pending: signInState(),
      claims: claims(),
    });

    expect(result).toEqual({ outcome: 'refused', reason: 'state_not_bound' });
    expect(world.grants).toEqual([]);
  });
});

interface Spies {
  unitOfWorkRuns: number;
  sessionsStarted: number;
  challengesCreated: number;
  deletionReauthCalls: { pending: OAuthState; claims: GoogleClaims }[];
}

function completeSignIn(
  pending: OAuthState | null,
  claimsOrFailure: GoogleClaims | GoogleSignInFailed,
  deletionOutcome:
    | { outcome: 'issued'; token: string; userId: string }
    | { outcome: 'refused'; reason: 'another_identity' } = {
    outcome: 'issued',
    token: 'grant-token',
    userId: USER_ID,
  },
) {
  const spies: Spies = {
    unitOfWorkRuns: 0,
    sessionsStarted: 0,
    challengesCreated: 0,
    deletionReauthCalls: [],
  };
  const oauthStates: OAuthStateRepository = {
    create: () => Promise.resolve(),
    consume: () => Promise.resolve(pending),
  };
  const google: GoogleIdentityProvider = {
    authorizationUrl: () => 'unused',
    exchangeCode: () =>
      claimsOrFailure instanceof GoogleSignInFailed
        ? Promise.reject(claimsOrFailure)
        : Promise.resolve(claimsOrFailure),
  };
  const unitOfWork = {
    run: vi.fn(() => {
      spies.unitOfWorkRuns += 1;
      return Promise.resolve({ outcome: 'refused', reason: 'conflict' });
    }),
  } as unknown as UnitOfWork;
  const useCase = new CompleteGoogleSignIn({
    oauthStates,
    google,
    tokenGenerator: tokens,
    unitOfWork,
    startSession: {
      execute: () => {
        spies.sessionsStarted += 1;
        return Promise.reject(new Error('a session must not start'));
      },
    } as unknown as StartSession,
    createSignInChallenge: {
      execute: () => {
        spies.challengesCreated += 1;
        return Promise.reject(new Error('a challenge must not be created'));
      },
    } as unknown as CreateSignInChallenge,
    completeDeletionReauth: {
      execute: (input: { pending: OAuthState; claims: GoogleClaims }) => {
        spies.deletionReauthCalls.push(input);
        return Promise.resolve(deletionOutcome);
      },
    } as unknown as CompleteDeletionReauth,
    clock: { now: () => NOW },
  });
  const run = (params: Record<string, string> = { state: 's', code: 'c' }) =>
    useCase.execute({ params, binding: 'b' });
  return { run, spies };
}

describe('CompleteGoogleSignIn purpose dispatch', () => {
  it('hands a delete_account state to the grant path and never resolves, links or creates an account, nor starts a session (AC-07)', async () => {
    const { run, spies } = completeSignIn(deleteState(), claims());

    const result = await run();

    expect(result).toEqual({
      outcome: 'deletion_grant_issued',
      token: 'grant-token',
      language: 'en',
      userId: USER_ID,
    });
    expect(spies.deletionReauthCalls).toHaveLength(1);
    expect(spies.deletionReauthCalls[0]?.pending.userId).toBe(USER_ID);
    expect(spies.unitOfWorkRuns).toBe(0);
    expect(spies.sessionsStarted).toBe(0);
    expect(spies.challengesCreated).toBe(0);
  });

  it('does not check email_verified for a delete_account state: the linked subject proves the identity (AC-06)', async () => {
    const { run, spies } = completeSignIn(deleteState(), claims({ emailVerified: false }));

    const result = await run();

    expect(result.outcome).toBe('deletion_grant_issued');
    expect(spies.unitOfWorkRuns).toBe(0);
  });

  it('answers a refused re-authentication as a failure of the delete_account purpose with no account touched (AC-07, sad path)', async () => {
    const { run, spies } = completeSignIn(deleteState(), claims(), {
      outcome: 'refused',
      reason: 'another_identity',
    });

    const result = await run();

    expect(result).toEqual({
      outcome: 'failed',
      reason: 'another_identity',
      language: 'en',
      purpose: 'delete_account',
    });
    expect(spies.unitOfWorkRuns).toBe(0);
    expect(spies.sessionsStarted).toBe(0);
  });

  it('carries the delete_account purpose on Google errors and exchange failures (A-11, sad path)', async () => {
    const denied = completeSignIn(deleteState(), claims());
    const noCode = completeSignIn(deleteState(), claims());
    const exchange = completeSignIn(deleteState(), new GoogleSignInFailed('bad_signature'));

    expect(await denied.run({ state: 's', error: 'access_denied' })).toMatchObject({
      outcome: 'failed',
      reason: 'denied_at_google',
      purpose: 'delete_account',
    });
    expect(await noCode.run({ state: 's' })).toMatchObject({
      reason: 'missing_code',
      purpose: 'delete_account',
    });
    expect(await exchange.run()).toMatchObject({
      reason: 'bad_signature',
      purpose: 'delete_account',
    });
    for (const { spies } of [denied, noCode, exchange]) {
      expect(spies.deletionReauthCalls).toEqual([]);
    }
  });

  it('never reaches the grant path for a sign_in state, which resolves accounts as before (AC-07, sad path)', async () => {
    const { run, spies } = completeSignIn(signInState(), claims());

    const result = await run();

    expect(result).toEqual({
      outcome: 'failed',
      reason: 'conflict',
      language: 'en',
      purpose: 'sign_in',
    });
    expect(spies.deletionReauthCalls).toEqual([]);
    expect(spies.unitOfWorkRuns).toBe(1);
  });

  it('keeps the unverified-email refusal for a sign_in state, before any account is touched (FR-04)', async () => {
    const { run, spies } = completeSignIn(signInState(), claims({ emailVerified: false }));

    expect(await run()).toMatchObject({
      outcome: 'failed',
      reason: 'email_unverified',
      purpose: 'sign_in',
    });
    expect(spies.unitOfWorkRuns).toBe(0);
    expect(spies.deletionReauthCalls).toEqual([]);
  });

  it('reports a null purpose when no state was consumed (A-11, sad path)', async () => {
    const unknown = completeSignIn(null, claims());

    expect(await unknown.run()).toEqual({
      outcome: 'failed',
      reason: 'unknown_state',
      language: null,
      purpose: null,
    });
    expect(await unknown.run({ code: 'c' })).toMatchObject({
      reason: 'missing_state',
      purpose: null,
    });
    expect(await unknown.run({ state: ['a', 'b'] as unknown as string })).toMatchObject({
      reason: 'repeated_parameter',
      purpose: null,
    });
  });
});
