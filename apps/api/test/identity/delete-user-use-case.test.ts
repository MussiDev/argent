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
import { TotpInvalid, Unauthenticated } from '../../src/identity/domain/errors';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const PASSWORD = 'a long enough passphrase';
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
}

function build(world: World) {
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
      Promise.resolve({
        userId: USER_ID,
        secretSealed: 'sealed',
        enabledAt: new Date('2026-01-01T00:00:00Z'),
        lastUsedStep: 0,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
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
    erase: ({ credentialsVersion }: EraseUserInput): Promise<EraseUserResult> => {
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
