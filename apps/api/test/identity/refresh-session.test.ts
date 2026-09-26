import { describe, expect, it } from 'vitest';
import type { AccessTokenIssuer } from '../../src/identity/application/ports/access-token-issuer';
import type {
  NewSession,
  Session,
  SessionRepository,
} from '../../src/identity/application/ports/session-repository';
import type { TokenGenerator } from '../../src/identity/application/ports/token-generator';
import type { User, UserRepository } from '../../src/identity/application/ports/user-repository';
import type {
  TransactionalRepositories,
  UnitOfWork,
} from '../../src/identity/application/ports/unit-of-work';
import { RefreshSession } from '../../src/identity/application/refresh-session';
import { MutableClock } from '../fakes/mutable-clock';

const NOW = new Date('2026-09-26T12:00:00.000Z');

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: 'user-1',
    familyId: 'family-1',
    refreshTokenHash: 'hash:presented',
    createdAt: NOW,
    lastUsedAt: NOW,
    revokedAt: null,
    replacedBy: null,
    credentialsVersion: 0,
    ...overrides,
  };
}

/**
 * In-memory sessions with a unit of work that only keeps what a transaction created when the
 * transaction resolves, like PostgreSQL does on commit and rollback.
 */
function buildRefresh(
  current: Session,
  options: { claim: boolean; userCredentialsVersion?: number },
) {
  const committed: Session[] = [current];
  const revokedFamilies: string[] = [];
  let created = 0;

  const createSession = (newSession: NewSession): Session => {
    created += 1;
    const id = `successor-${created}`;
    return session({
      ...newSession,
      id,
      familyId: newSession.familyId ?? id,
      revokedAt: null,
      replacedBy: null,
    });
  };

  const unsupported = () => Promise.reject(new Error('not used by RefreshSession'));
  const sessions: SessionRepository = {
    create: (newSession) => {
      const row = createSession(newSession);
      committed.push(row);
      return Promise.resolve(row);
    },
    findById: (id) => Promise.resolve(committed.find((row) => row.id === id) ?? null),
    findByRefreshTokenHash: (hash) =>
      Promise.resolve(committed.find((row) => row.refreshTokenHash === hash) ?? null),
    markReplaced: unsupported,
    revoke: unsupported,
    revokeFamily: (familyId) => {
      revokedFamilies.push(familyId);
      return Promise.resolve();
    },
    revokeAllForUser: unsupported,
  };

  const unitOfWork: UnitOfWork = {
    run: async <T>(work: (repositories: TransactionalRepositories) => Promise<T>) => {
      const staged: Session[] = [];
      const transactional: SessionRepository = {
        ...sessions,
        create: (newSession) => {
          const row = createSession(newSession);
          staged.push(row);
          return Promise.resolve(row);
        },
        // The fake's claim result is fixed by the test: false means another request won.
        markReplaced: () => Promise.resolve(options.claim),
      };
      const result = await work({
        sessions: transactional,
        users: {} as TransactionalRepositories['users'],
        oneTimeTokens: {} as TransactionalRepositories['oneTimeTokens'],
        emailSender: {} as TransactionalRepositories['emailSender'],
      });
      committed.push(...staged);
      return result;
    },
  };

  const tokenGenerator: TokenGenerator = {
    generate: () => 'next-refresh-token',
    hash: (token) => `hash:${token}`,
  };
  const accessTokens: AccessTokenIssuer = {
    ttlSeconds: 900,
    issue: (claims) => Promise.resolve(`jwt:${claims.sessionId}`),
    verify: () => Promise.resolve(null),
  };

  const users = {
    findById: (id: string) =>
      Promise.resolve(
        id === current.userId
          ? ({ id, credentialsVersion: options.userCredentialsVersion ?? 0 } as User)
          : null,
      ),
  } as unknown as UserRepository;

  const refreshSession = new RefreshSession({
    sessions,
    users,
    tokenGenerator,
    accessTokens,
    unitOfWork,
    clock: new MutableClock(NOW),
  });
  return { refreshSession, committed, revokedFamilies };
}

describe('RefreshSession', () => {
  it('treats a lost rotation claim as reuse: revokes the family and keeps no successor (A-6, R-15)', async () => {
    const { refreshSession, committed, revokedFamilies } = buildRefresh(session(), {
      claim: false,
    });

    const result = await refreshSession.execute('presented');

    expect(result).toEqual({ outcome: 'reused', userId: 'user-1', familyId: 'family-1' });
    expect(revokedFamilies).toEqual(['family-1']);
    expect(committed.map((row) => row.id)).toEqual(['session-1']);
  });

  it('rotates when the claim is won: one successor in the same family', async () => {
    const { refreshSession, committed, revokedFamilies } = buildRefresh(session(), {
      claim: true,
    });

    const result = await refreshSession.execute('presented');

    expect(result).toMatchObject({
      outcome: 'rotated',
      session: { sessionId: 'successor-1', refreshToken: 'next-refresh-token' },
    });
    expect(revokedFamilies).toEqual([]);
    expect(committed.map((row) => [row.id, row.familyId])).toEqual([
      ['session-1', 'family-1'],
      ['successor-1', 'family-1'],
    ]);
  });

  it('treats a rotated token (replacedBy set) as reuse and revokes the family', async () => {
    const rotated = session({ revokedAt: NOW, replacedBy: 'session-2' });
    const { refreshSession, revokedFamilies } = buildRefresh(rotated, { claim: true });

    expect(await refreshSession.execute('presented')).toMatchObject({ outcome: 'reused' });
    expect(revokedFamilies).toEqual(['family-1']);
  });

  it('only rejects a token revoked without replacement (sign-out): no family revocation (A-2)', async () => {
    const signedOut = session({ revokedAt: NOW, replacedBy: null });
    const { refreshSession, committed, revokedFamilies } = buildRefresh(signedOut, {
      claim: true,
    });

    expect(await refreshSession.execute('presented')).toEqual({ outcome: 'rejected' });
    expect(revokedFamilies).toEqual([]);
    expect(committed).toHaveLength(1);
  });

  it("rejects a session whose credentials version differs from the user's, rotating nothing (AC-10)", async () => {
    const stale = session({ credentialsVersion: 0 });
    const { refreshSession, committed, revokedFamilies } = buildRefresh(stale, {
      claim: true,
      userCredentialsVersion: 1,
    });

    expect(await refreshSession.execute('presented')).toEqual({ outcome: 'rejected' });
    expect(committed.map((row) => row.id)).toEqual(['session-1']);
    expect(revokedFamilies).toEqual([]);
  });

  it('gives the successor the credentials version of the session it replaces', async () => {
    const current = session({ credentialsVersion: 2 });
    const { refreshSession, committed } = buildRefresh(current, {
      claim: true,
      userCredentialsVersion: 2,
    });

    expect(await refreshSession.execute('presented')).toMatchObject({ outcome: 'rotated' });
    expect(committed.map((row) => [row.id, row.credentialsVersion])).toEqual([
      ['session-1', 2],
      ['successor-1', 2],
    ]);
  });
});
