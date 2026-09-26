import { describe, expect, it } from 'vitest';
import {
  ConfirmPasswordReset,
  type ConfirmPasswordResetDependencies,
} from '../../src/identity/application/confirm-password-reset';
import type {
  AttemptLimiter,
  AttemptPolicy,
} from '../../src/identity/application/ports/attempt-limiter';
import type { OneTimeTokenRepository } from '../../src/identity/application/ports/one-time-token-repository';
import type { SessionRepository } from '../../src/identity/application/ports/session-repository';
import type { UnitOfWork } from '../../src/identity/application/ports/unit-of-work';
import type { User, UserRepository } from '../../src/identity/application/ports/user-repository';
import {
  RequestPasswordReset,
  RESET_EMAIL_POLICY,
  RESET_IP_POLICY,
} from '../../src/identity/application/request-password-reset';
import { PasswordCheckUnavailable } from '../../src/identity/domain/errors';
import { InMemoryEmailSender } from '../fakes/in-memory-email-sender';

const IP = '203.0.113.9';
const NOW = new Date('2026-09-26T12:00:00.000Z');

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'ana@example.com',
    passwordHash: '$argon2id$old',
    emailVerifiedAt: new Date(0),
    defaultRateType: 'mep',
    displayCurrency: 'ARS',
    timeZone: 'America/Cordoba',
    language: 'en',
    createdAt: new Date(0),
    credentialsVersion: 0,
    passwordChangedAt: null,
    ...overrides,
  };
}

function buildRequest(options: { existing?: User; ipLimit?: number; emailLimit?: number } = {}) {
  const calls: string[] = [];
  const emailSender = new InMemoryEmailSender();
  const counts = new Map<string, number>();
  const attemptLimiter: AttemptLimiter = {
    isLimitReached: () => Promise.reject(new Error('reset must record, not peek')),
    release: () => Promise.reject(new Error('reset never refunds an attempt')),
    record: (policy: AttemptPolicy, key: string) => {
      calls.push(`record:${policy.kind}:${key}`);
      const count = (counts.get(policy.kind) ?? 0) + 1;
      counts.set(policy.kind, count);
      const limit = policy.kind === 'reset_ip' ? options.ipLimit : options.emailLimit;
      return Promise.resolve({ count, allowed: count <= (limit ?? 5), windowStart: new Date(0) });
    },
  };
  const users = {
    findByEmail: (email: { value: string }) => {
      calls.push(`findByEmail:${email.value}`);
      return Promise.resolve(options.existing?.email === email.value ? options.existing : null);
    },
  } as unknown as UserRepository;
  const requestPasswordReset = new RequestPasswordReset({ attemptLimiter, users, emailSender });
  return { requestPasswordReset, calls, emailSender };
}

describe('RequestPasswordReset', () => {
  it('limits reset requests per IP and per email, per hour (R-09)', () => {
    expect(RESET_IP_POLICY).toEqual({ kind: 'reset_ip', limit: 5, windowSeconds: 3600 });
    expect(RESET_EMAIL_POLICY).toEqual({ kind: 'reset_email', limit: 5, windowSeconds: 3600 });
  });

  it('records the IP and the normalized email before looking the user up', async () => {
    const { requestPasswordReset, calls, emailSender } = buildRequest({ existing: user() });

    const result = await requestPasswordReset.execute({ email: ' Ana@Example.com ', ip: IP });

    expect(result).toEqual({ outcome: 'enqueued', userId: 'user-1' });
    expect(calls).toEqual([
      `record:reset_ip:${IP}`,
      'record:reset_email:ana@example.com',
      'findByEmail:ana@example.com',
    ]);
    expect(emailSender.enqueued).toEqual([
      { kind: 'password_reset', userId: 'user-1', toEmail: 'ana@example.com', language: 'en' },
    ]);
  });

  it('enqueues a discard row for an unknown email and for an unverified one (NFR-08)', async () => {
    const unknown = buildRequest();
    const unverified = buildRequest({ existing: user({ emailVerifiedAt: null }) });

    expect(
      await unknown.requestPasswordReset.execute({ email: 'ana@example.com', ip: IP }),
    ).toEqual({ outcome: 'discarded' });
    expect(
      await unverified.requestPasswordReset.execute({ email: 'ana@example.com', ip: IP }),
    ).toEqual({ outcome: 'discarded' });

    for (const { calls, emailSender } of [unknown, unverified]) {
      expect(calls).toEqual([
        `record:reset_ip:${IP}`,
        'record:reset_email:ana@example.com',
        'findByEmail:ana@example.com',
      ]);
      expect(emailSender.enqueued).toEqual([
        { kind: 'discard', userId: null, toEmail: null, language: 'es' },
      ]);
    }
  });

  it('rejects over the IP limit without counting the email or looking it up', async () => {
    const { requestPasswordReset, calls, emailSender } = buildRequest({
      existing: user(),
      ipLimit: 0,
    });

    await expect(
      requestPasswordReset.execute({ email: 'ana@example.com', ip: IP }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(calls).toEqual([`record:reset_ip:${IP}`]);
    expect(emailSender.enqueued).toEqual([]);
  });

  it('rejects over the email limit without looking it up, and counts unknown IPs together', async () => {
    const { requestPasswordReset, calls, emailSender } = buildRequest({
      existing: user(),
      emailLimit: 0,
    });

    await expect(
      requestPasswordReset.execute({ email: 'ana@example.com', ip: undefined }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(calls).toEqual(['record:reset_ip:unknown', 'record:reset_email:ana@example.com']);
    expect(emailSender.enqueued).toEqual([]);
  });
});

function buildConfirm(options: { consumes?: boolean; breachCheck?: () => Promise<boolean> } = {}) {
  const calls: string[] = [];
  let committed = false;
  const oneTimeTokens = {
    consume: (tokenHash: string, purpose: string) => {
      calls.push(`consume:${tokenHash}:${purpose}`);
      return Promise.resolve(
        options.consumes === false ? null : { id: 'token-1', userId: 'user-1' },
      );
    },
  } as unknown as OneTimeTokenRepository;
  const users = {
    changePassword: (id: string, hash: string, at: Date) => {
      calls.push(`changePassword:${id}:${hash}:${at.toISOString()}`);
      return Promise.resolve();
    },
  } as unknown as UserRepository;
  const sessions = {
    revokeAllForUser: (userId: string) => {
      calls.push(`revokeAllForUser:${userId}`);
      return Promise.resolve();
    },
  } as unknown as SessionRepository;
  const unitOfWork: UnitOfWork = {
    run: async (work) => {
      calls.push('begin');
      const result = await work({
        users,
        oneTimeTokens,
        sessions,
        emailSender: new InMemoryEmailSender(),
      });
      committed = true;
      return result;
    },
  };
  const deps: ConfirmPasswordResetDependencies = {
    tokenGenerator: {
      generate: () => 'unused',
      hash: (token) => `sha256(${token})`,
    },
    clock: { now: () => NOW },
    breachedPasswordChecker: {
      isBreached: () => {
        calls.push('breachCheck');
        return options.breachCheck ? options.breachCheck() : Promise.resolve(false);
      },
    },
    passwordHasher: {
      hash: (password) => {
        calls.push('hash');
        return Promise.resolve(`$argon2id$${password}`);
      },
      verify: () => Promise.reject(new Error('confirm never verifies')),
    },
    unitOfWork,
  };
  return { confirm: new ConfirmPasswordReset(deps), calls, isCommitted: () => committed };
}

const NEW_PASSWORD = 'a brand new passphrase';

describe('ConfirmPasswordReset', () => {
  it('consumes the token, checks and hashes the password, changes it (bumping the credentials version) and revokes every session in one unit of work', async () => {
    const { confirm, calls, isCommitted } = buildConfirm();

    expect(await confirm.execute({ token: 'tok', newPassword: NEW_PASSWORD })).toEqual({
      userId: 'user-1',
    });
    expect(calls).toEqual([
      'begin',
      'consume:sha256(tok):password_reset',
      'breachCheck',
      'hash',
      `changePassword:user-1:$argon2id$${NEW_PASSWORD}:${NOW.toISOString()}`,
      'revokeAllForUser:user-1',
    ]);
    expect(isCommitted()).toBe(true);
  });

  it('rejects an unusable token with TOKEN_INVALID before any password work', async () => {
    const { confirm, calls, isCommitted } = buildConfirm({ consumes: false });

    await expect(
      confirm.execute({ token: 'tok', newPassword: NEW_PASSWORD }),
    ).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    expect(calls).toEqual(['begin', 'consume:sha256(tok):password_reset']);
    expect(isCommitted()).toBe(false);
  });

  it('rejects a short password with PASSWORD_TOO_SHORT before opening the unit of work', async () => {
    const { confirm, calls, isCommitted } = buildConfirm();

    await expect(confirm.execute({ token: 'tok', newPassword: 'short' })).rejects.toMatchObject({
      code: 'PASSWORD_TOO_SHORT',
    });
    expect(calls).toEqual([]);
    expect(isCommitted()).toBe(false);
  });

  it('rolls everything back (token included) when the password is breached or cannot be checked', async () => {
    const cases = [
      {
        password: NEW_PASSWORD,
        code: 'PASSWORD_BREACHED',
        breachCheck: () => Promise.resolve(true),
      },
      {
        password: NEW_PASSWORD,
        code: 'PASSWORD_CHECK_UNAVAILABLE',
        breachCheck: () => Promise.reject(new PasswordCheckUnavailable()),
      },
    ];
    for (const { password, code, breachCheck } of cases) {
      const { confirm, calls, isCommitted } = buildConfirm({ breachCheck });

      await expect(confirm.execute({ token: 'tok', newPassword: password })).rejects.toMatchObject({
        code,
      });
      expect(calls).not.toContain('hash');
      expect(calls.some((call) => call.startsWith('changePassword'))).toBe(false);
      expect(calls.some((call) => call.startsWith('revokeAllForUser'))).toBe(false);
      expect(isCommitted()).toBe(false);
    }
  });
});
