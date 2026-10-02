import { describe, expect, it } from 'vitest';
import type {
  AttemptLimiter,
  AttemptPolicy,
} from '../../src/identity/application/ports/attempt-limiter';
import type { PasswordHasher } from '../../src/identity/application/ports/password-hasher';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../src/identity/application/ports/unit-of-work';
import type {
  NewUser,
  User,
  UserRepository,
} from '../../src/identity/application/ports/user-repository';
import { REGISTER_IP_POLICY, RegisterUser } from '../../src/identity/application/register-user';
import type { OneTimeTokenRepository } from '../../src/identity/application/ports/one-time-token-repository';
import type { SessionRepository } from '../../src/identity/application/ports/session-repository';
import type { UserIdentityRepository } from '../../src/identity/application/ports/user-identity-repository';
import { DuplicateEmail } from '../../src/identity/domain/errors';
import { InMemoryEmailSender } from '../fakes/in-memory-email-sender';

const DUMMY_HASH = '$argon2id$dummy';

/** Records the order in which ports are used, to check what happens before what. */
function buildRegisterUser(options: { existing?: string[]; limit?: number; raceOn?: string } = {}) {
  const calls: string[] = [];
  const created: NewUser[] = [];
  const emailSender = new InMemoryEmailSender();
  let recorded = 0;

  const attemptLimiter: AttemptLimiter = {
    isLimitReached: () => Promise.reject(new Error('register must record, not peek')),
    release: () => Promise.reject(new Error('register never refunds an attempt')),
    record: (policy: AttemptPolicy, key: string) => {
      calls.push(`record:${policy.kind}:${key}`);
      recorded += 1;
      return Promise.resolve({
        count: recorded,
        allowed: recorded <= (options.limit ?? 5),
        windowStart: new Date(0),
      });
    },
  };
  const passwordHasher: PasswordHasher = {
    hash: () => {
      calls.push('hash');
      return Promise.resolve('$argon2id$real');
    },
    verify: (hash) => {
      calls.push(`verify:${hash}`);
      return Promise.resolve(false);
    },
  };
  const users: UserRepository = {
    create: (user) => {
      calls.push('create');
      if (user.email.value === options.raceOn) return Promise.reject(new DuplicateEmail());
      created.push(user);
      return Promise.resolve({
        id: `user-${created.length}`,
        email: user.email.value,
        passwordHash: user.passwordHash,
        emailVerifiedAt: null,
        defaultRateType: user.defaultRateType,
        displayCurrency: user.displayCurrency,
        timeZone: user.timeZone,
        language: user.language,
        createdAt: new Date(),
        credentialsVersion: 0,
        passwordChangedAt: null,
      } satisfies User);
    },
    findByEmail: (email) => {
      calls.push('findByEmail');
      const exists = options.existing?.includes(email.value) ?? false;
      return Promise.resolve(exists ? ({ id: 'existing' } as User) : null);
    },
    findById: () => Promise.resolve(null),
    markEmailVerified: () => Promise.resolve(),
    changePassword: () => Promise.resolve(),
    supersedeUnverified: () => Promise.reject(new Error('unused')),
    bumpCredentialsVersion: () => Promise.reject(new Error('unused')),
  };
  const unitOfWork: UnitOfWork = {
    run: (work) =>
      work({
        users,
        emailSender,
        oneTimeTokens: {} as OneTimeTokenRepository,
        sessions: {} as SessionRepository,
        identities: {} as UserIdentityRepository,
        twoFactor: {} as TransactionalRepositories['twoFactor'],
        recoveryCodes: {} as TransactionalRepositories['recoveryCodes'],
        signInChallenges: {} as TransactionalRepositories['signInChallenges'],
      }),
  };
  const registerUser = new RegisterUser({
    attemptLimiter,
    breachedPasswordChecker: {
      isBreached: (password) => {
        calls.push('breachCheck');
        return Promise.resolve(password === 'password123');
      },
    },
    passwordHasher,
    dummyPasswordHash: DUMMY_HASH,
    users,
    emailSender,
    unitOfWork,
  });
  return { registerUser, calls, created, emailSender };
}

const INPUT = {
  email: 'Ana@Example.com',
  password: 'a long enough passphrase',
  displayName: 'Ana Pérez',
  ip: '203.0.113.9',
};

describe('RegisterUser', () => {
  it('limits registrations to 5 per IP per hour', () => {
    expect(REGISTER_IP_POLICY).toEqual({ kind: 'register_ip', limit: 5, windowSeconds: 3600 });
  });

  it('records the IP attempt before the password checks, the lookup and any hashing', async () => {
    const { registerUser, calls, created, emailSender } = buildRegisterUser();

    const result = await registerUser.execute(INPUT);

    expect(result).toEqual({ outcome: 'created', userId: 'user-1' });
    expect(calls).toEqual([
      'record:register_ip:203.0.113.9',
      'breachCheck',
      'findByEmail',
      'hash',
      'create',
    ]);
    expect(created[0]?.email.value).toBe('ana@example.com');
    expect(emailSender.enqueued).toEqual([
      { kind: 'verification', userId: 'user-1', toEmail: 'ana@example.com', language: 'es' },
    ]);
  });

  it('stores the display name on the created account only', async () => {
    const created = buildRegisterUser();
    await created.registerUser.execute(INPUT);
    expect(created.created[0]?.displayName).toBe('Ana Pérez');

    const existing = buildRegisterUser({ existing: ['ana@example.com'] });
    await existing.registerUser.execute(INPUT);
    expect(existing.created).toEqual([]);
    expect(existing.calls).not.toContain('create');
  });

  it('stores nothing from a concurrent duplicate registration', async () => {
    const raced = buildRegisterUser({ raceOn: 'ana@example.com' });

    await raced.registerUser.execute(INPUT);

    expect(raced.created).toEqual([]);
  });

  it('rejects over the limit with RATE_LIMITED before touching the password', async () => {
    const { registerUser, calls, emailSender } = buildRegisterUser({ limit: 0 });

    await expect(registerUser.execute(INPUT)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(calls).toEqual(['record:register_ip:203.0.113.9']);
    expect(emailSender.enqueued).toEqual([]);
  });

  it('verifies the dummy hash and enqueues a discard row for an existing email', async () => {
    const { registerUser, calls, created, emailSender } = buildRegisterUser({
      existing: ['ana@example.com'],
    });

    const result = await registerUser.execute({ ...INPUT, language: 'en' });

    expect(result).toEqual({ outcome: 'existing' });
    expect(calls).toEqual([
      'record:register_ip:203.0.113.9',
      'breachCheck',
      'findByEmail',
      `verify:${DUMMY_HASH}`,
    ]);
    expect(created).toEqual([]);
    expect(emailSender.enqueued).toEqual([
      { kind: 'discard', userId: null, toEmail: null, language: 'en' },
    ]);
  });

  it('absorbs a concurrent duplicate insert as an existing email', async () => {
    const { registerUser, emailSender } = buildRegisterUser({ raceOn: 'ana@example.com' });

    await expect(registerUser.execute(INPUT)).resolves.toEqual({ outcome: 'existing' });
    expect(emailSender.enqueued.map((email) => email.kind)).toEqual(['discard']);
  });

  it('applies the password policy (length, then breach) to new and existing emails alike', async () => {
    const existing = buildRegisterUser({ existing: ['ana@example.com'] });
    await expect(
      existing.registerUser.execute({ ...INPUT, password: '123456789' }),
    ).rejects.toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
    await expect(
      existing.registerUser.execute({ ...INPUT, password: 'password123' }),
    ).rejects.toMatchObject({ code: 'PASSWORD_BREACHED' });
    expect(existing.calls).not.toContain('findByEmail');
  });
});
