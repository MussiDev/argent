import { describe, expect, it } from 'vitest';
import { DeleteUser } from '../../src/identity/application/delete-user';
import type {
  AttemptLimiter,
  AttemptPolicy,
} from '../../src/identity/application/ports/attempt-limiter';
import type { PasswordHasher } from '../../src/identity/application/ports/password-hasher';
import type { RecoveryCodeRepository } from '../../src/identity/application/ports/recovery-code-repository';
import type { SecretBox } from '../../src/identity/application/ports/secret-box';
import type { TotpEngine } from '../../src/identity/application/ports/totp';
import type { TwoFactorRepository } from '../../src/identity/application/ports/two-factor-repository';
import type {
  EraseUserInput,
  EraseUserResult,
  UserDeletionRepository,
} from '../../src/identity/application/ports/user-deletion-repository';
import type { User, UserRepository } from '../../src/identity/application/ports/user-repository';
import type { SessionRepository } from '../../src/identity/application/ports/session-repository';
import type { DeletionGrantRepository } from '../../src/identity/application/ports/deletion-grant-repository';
import {
  ReauthenticationRequired,
  TotpInvalid,
  Unauthenticated,
} from '../../src/identity/domain/errors';
import { CryptoTokenGenerator } from '../../src/identity/infrastructure/security/crypto-token-generator';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const PASSWORD = 'a long enough passphrase';
const FAMILY_ID = '00000000-0000-4000-8000-0000000000f1';
const GRANT_TOKEN = 'a-grant-token';
const GOOD_CODE = '123456';
const WRONG_CODE = '654321';

const baseUser: User = {
  id: USER_ID,
  email: 'ana@example.com',
  passwordHash: `hash:${PASSWORD}`,
  emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
  defaultRateType: 'oficial',
  displayCurrency: 'ARS',
  timeZone: 'America/Cordoba',
  language: 'es',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  credentialsVersion: 1,
  passwordChangedAt: null,
};

class InMemoryLimiter implements AttemptLimiter {
  readonly counts = new Map<string, number>();
  isLimitReached(): Promise<boolean> {
    return Promise.resolve(false);
  }
  record(policy: AttemptPolicy, key: string) {
    const id = `${policy.kind}|${key}`;
    const count = (this.counts.get(id) ?? 0) + 1;
    this.counts.set(id, count);
    return Promise.resolve({ count, allowed: count <= policy.limit, windowStart: new Date(0) });
  }
  release(policy: AttemptPolicy, key: string): Promise<void> {
    const id = `${policy.kind}|${key}`;
    this.counts.set(id, Math.max(0, (this.counts.get(id) ?? 0) - 1));
    return Promise.resolve();
  }
  total(): number {
    return [...this.counts.values()].reduce((sum, count) => sum + count, 0);
  }
}

interface World {
  user: User | null;
  /** Runs when the second-factor code is checked, i.e. between the first read and `erase`. */
  duringCheck: () => void;
  findByIdCalls: number;
  failSecondFindById: boolean;
  erased: boolean;
  /** The session family of the asking session; null when the session row is gone. */
  familyId: string | null;
  /** Whether `findLive` finds the grant; its arguments are recorded in `findLiveCalls`. */
  grantLive: boolean;
  findLiveCalls: unknown[][];
  eraseResult: EraseUserResult | null;
  eraseInputs: EraseUserInput[];
}

function build(world: World, { withTwoFactor = true }: { withTwoFactor?: boolean } = {}) {
  const limiter = new InMemoryLimiter();
  const refundFailures: unknown[] = [];
  const users = {
    findById: () => {
      world.findByIdCalls += 1;
      if (world.findByIdCalls === 2 && world.failSecondFindById) {
        return Promise.reject(new Error('database fault'));
      }
      return Promise.resolve(world.user);
    },
  } as unknown as UserRepository;
  const twoFactor: TwoFactorRepository = {
    findByUserId: () =>
      Promise.resolve(
        withTwoFactor
          ? {
              userId: USER_ID,
              secretSealed: 'sealed',
              enabledAt: new Date('2026-01-01T00:00:00Z'),
              lastUsedStep: 0,
              createdAt: new Date('2026-01-01T00:00:00Z'),
            }
          : null,
      ),
    advanceLastUsedStep: () => Promise.resolve(true),
  } as unknown as TwoFactorRepository;
  const totp = {
    verify: (_secret: string, code: string) => {
      world.duringCheck();
      return code === GOOD_CODE ? 1 : null;
    },
  } as unknown as TotpEngine;
  const secretBox: SecretBox = { seal: (value) => value, open: () => 'secret' };
  const passwordHasher: PasswordHasher = {
    hash: (password) => Promise.resolve(`hash:${password}`),
    verify: (hash, password) => Promise.resolve(hash === `hash:${password}`),
  };
  const userDeletion: UserDeletionRepository = {
    erase: (input: EraseUserInput): Promise<EraseUserResult> => {
      const { credentialsVersion } = input;
      world.eraseInputs.push(input);
      if (world.eraseResult) return Promise.resolve(world.eraseResult);
      if (!world.user || world.user.credentialsVersion !== credentialsVersion) {
        return Promise.resolve('stale');
      }
      world.erased = true;
      return Promise.resolve('erased');
    },
  };
  const deleteUser = new DeleteUser({
    users,
    twoFactor,
    recoveryCodes: {} as RecoveryCodeRepository,
    totp,
    secretBox,
    passwordHasher,
    attemptLimiter: limiter,
    userDeletion,
    sessions: {
      findById: () =>
        Promise.resolve(world.familyId === null ? null : { familyId: world.familyId }),
    } as unknown as SessionRepository,
    deletionGrants: {
      replace: () => Promise.resolve(),
      findLive: (...args: unknown[]) => {
        world.findLiveCalls.push(args);
        return Promise.resolve(world.grantLive ? ({} as never) : null);
      },
    } satisfies DeletionGrantRepository,
    tokenGenerator: new CryptoTokenGenerator(),
    clock: { now: () => new Date('2026-06-01T00:00:00Z') },
    reportRefundFailure: (error) => refundFailures.push(error),
    reportRecordFailure: () => undefined,
  });
  return { deleteUser, limiter, refundFailures };
}

const newWorld = (overrides: Partial<World> = {}): World => ({
  user: { ...baseUser },
  duringCheck: () => undefined,
  findByIdCalls: 0,
  failSecondFindById: false,
  erased: false,
  familyId: FAMILY_ID,
  grantLive: true,
  findLiveCalls: [],
  eraseResult: null,
  eraseInputs: [],
  ...overrides,
});

const run = (deleteUser: DeleteUser, secondFactorCode: string) =>
  deleteUser.execute({
    userId: USER_ID,
    sessionId: '00000000-0000-4000-8000-0000000000aa',
    password: PASSWORD,
    secondFactorCode,
    grantToken: undefined,
    ip: '127.0.0.1',
  });

describe('DeleteUser second-factor outcomes with fake ports', () => {
  it('refunds the units and propagates the error when the re-read after an invalid code faults (error, sad path)', async () => {
    const world = newWorld({ failSecondFindById: true });
    const { deleteUser, limiter } = build(world);

    await expect(run(deleteUser, WRONG_CODE)).rejects.toThrow('database fault');

    expect(limiter.total()).toBe(0);
    expect(world.erased).toBe(false);
  });

  it('answers Unauthenticated and deletes nothing when the credentials version moves between the read and the erase with a valid code (race, sad path)', async () => {
    const world = newWorld();
    world.duringCheck = () => {
      if (world.user) world.user = { ...world.user, credentialsVersion: 2 };
    };
    const { deleteUser } = build(world);

    await expect(run(deleteUser, GOOD_CODE)).rejects.toBeInstanceOf(Unauthenticated);

    expect(world.erased).toBe(false);
  });

  it('refunds the units and answers Unauthenticated when the user is gone by the re-read after an invalid code (race, sad path)', async () => {
    const world = newWorld();
    world.duringCheck = () => {
      world.user = null;
    };
    const { deleteUser, limiter } = build(world);

    await expect(run(deleteUser, WRONG_CODE)).rejects.toBeInstanceOf(Unauthenticated);

    expect(limiter.total()).toBe(0);
  });

  it('refunds the units and answers Unauthenticated when the credentials version moved by the re-read after an invalid code (race, sad path)', async () => {
    const world = newWorld();
    world.duringCheck = () => {
      if (world.user) world.user = { ...world.user, credentialsVersion: 2 };
    };
    const { deleteUser, limiter } = build(world);

    await expect(run(deleteUser, WRONG_CODE)).rejects.toBeInstanceOf(Unauthenticated);

    expect(limiter.total()).toBe(0);
  });

  it('keeps the units and answers TotpInvalid for an invalid code on an unchanged account (sad path)', async () => {
    const world = newWorld();
    const { deleteUser, limiter } = build(world);

    await expect(run(deleteUser, WRONG_CODE)).rejects.toBeInstanceOf(TotpInvalid);

    // Two disable policies plus the sign-in account unit of the failure (NFR-01).
    expect(limiter.counts.get('sign_in_account|ana@example.com')).toBe(1);
    expect(limiter.total()).toBeGreaterThan(1);
    expect(world.erased).toBe(false);
  });
});

describe('DeleteUser password-less path with fake ports', () => {
  const passwordless = (): User => ({ ...baseUser, passwordHash: null });
  const withGrant = (deleteUser: DeleteUser, grantToken: string | null = GRANT_TOKEN) =>
    deleteUser.execute({
      userId: USER_ID,
      sessionId: '00000000-0000-4000-8000-0000000000aa',
      password: undefined,
      secondFactorCode: undefined,
      grantToken: grantToken ?? undefined,
      ip: '127.0.0.1',
    });

  it('looks the grant up by the hash of the cookie, the user, the session family and the credentials version, then erases with it (AC-08)', async () => {
    const world = newWorld({ user: passwordless() });
    const { deleteUser } = build(world, { withTwoFactor: false });

    await withGrant(deleteUser);

    const tokenHash = new CryptoTokenGenerator().hash(GRANT_TOKEN);
    expect(world.findLiveCalls).toHaveLength(1);
    expect(world.findLiveCalls[0]?.slice(0, 4)).toEqual([tokenHash, USER_ID, FAMILY_ID, 1]);
    expect(world.eraseInputs).toEqual([
      {
        userId: USER_ID,
        credentialsVersion: 1,
        grant: { tokenHash, sessionFamilyId: FAMILY_ID, now: new Date('2026-06-01T00:00:00Z') },
      },
    ]);
    expect(world.erased).toBe(true);
  });

  it('answers ReauthenticationRequired without reserving or erasing when there is no live grant or no cookie (AC-09, sad path)', async () => {
    for (const [grantLive, grantToken] of [
      [false, GRANT_TOKEN],
      [true, null],
    ] as const) {
      const world = newWorld({ user: passwordless(), grantLive });
      const { deleteUser, limiter } = build(world, { withTwoFactor: true });

      await expect(withGrant(deleteUser, grantToken)).rejects.toBeInstanceOf(
        ReauthenticationRequired,
      );

      expect(limiter.total()).toBe(0);
      expect(world.eraseInputs).toEqual([]);
    }
  });

  it('answers ReauthenticationRequired when the grant is used up between the lookup and the erase (AC-09, race, sad path)', async () => {
    const world = newWorld({ user: passwordless(), eraseResult: 'grant_invalid' });
    const { deleteUser } = build(world, { withTwoFactor: false });

    await expect(withGrant(deleteUser)).rejects.toBeInstanceOf(ReauthenticationRequired);
  });

  it('answers Unauthenticated when the erase finds the credentials version stale (sad path)', async () => {
    const world = newWorld({ user: passwordless(), eraseResult: 'stale' });
    const { deleteUser } = build(world, { withTwoFactor: false });

    await expect(withGrant(deleteUser)).rejects.toBeInstanceOf(Unauthenticated);
  });

  it('answers Unauthenticated when the asking session is gone (sad path)', async () => {
    const world = newWorld({ user: passwordless(), familyId: null });
    const { deleteUser } = build(world, { withTwoFactor: false });

    await expect(withGrant(deleteUser)).rejects.toBeInstanceOf(Unauthenticated);
    expect(world.eraseInputs).toEqual([]);
  });

  it('keeps the grant for a wrong second-factor code and erases nothing (AC-08, sad path)', async () => {
    const world = newWorld({ user: passwordless() });
    const { deleteUser } = build(world, { withTwoFactor: true });

    await expect(
      deleteUser.execute({
        userId: USER_ID,
        sessionId: '00000000-0000-4000-8000-0000000000aa',
        password: undefined,
        secondFactorCode: WRONG_CODE,
        grantToken: GRANT_TOKEN,
        ip: '127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(TotpInvalid);

    expect(world.eraseInputs).toEqual([]);
  });

  it('never uses a grant for a user with a password (AC-10, sad path)', async () => {
    const world = newWorld();
    const { deleteUser } = build(world, { withTwoFactor: false });

    await expect(withGrant(deleteUser)).rejects.toThrow();

    expect(world.findLiveCalls).toEqual([]);
    expect(world.eraseInputs).toEqual([]);
  });
});
