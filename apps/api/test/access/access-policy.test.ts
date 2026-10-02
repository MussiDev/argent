import { randomUUID } from 'node:crypto';
import type { AppError } from '@pesly/shared';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  assertIssuedScope,
  notFoundUnlessAllowed,
  OwnerOrGroupMemberAccessPolicy,
  ResourceNotFound,
  type AccessScope,
  type GroupMembershipReader,
} from '../../src/shared/access';
import { DenyAllGroupMembershipReader } from '../../src/shared/access/infrastructure/deny-all-group-membership-reader';
import type { AuthContext } from '../../src/shared/http/auth-context';
import { createErrorHandler } from '../../src/shared/http/error-handler';
import { requireVerifiedEmail } from '../../src/shared/http/require-verified-email';
import { createLogger } from '../../src/shared/logging/logger';

const USER = randomUUID();
const GROUP_A = randomUUID();
const GROUP_B = randomUUID();

function authOf(userId: string): AuthContext {
  return { userId, sessionId: 'session', emailVerified: true };
}

function readerWith(groupIds: string[]) {
  const groupIdsOf = vi.fn<GroupMembershipReader['groupIdsOf']>(() => Promise.resolve(groupIds));
  const reader: GroupMembershipReader = { groupIdsOf };
  return { reader, groupIdsOf };
}

describe('OwnerOrGroupMemberAccessPolicy.scopeFor', () => {
  it('scopes reads to the user and every group they belong to', async () => {
    const { reader, groupIdsOf } = readerWith([GROUP_A, GROUP_B]);
    const scope = await new OwnerOrGroupMemberAccessPolicy(reader).scopeFor(authOf(USER), 'read');

    expect(scope).toMatchObject({ userId: USER, action: 'read', groupIds: [GROUP_A, GROUP_B] });
    expect(groupIdsOf).toHaveBeenCalledWith(USER);
  });

  it('scopes writes to the owner only (no group roles until PRD 05)', async () => {
    const { reader, groupIdsOf } = readerWith([GROUP_A]);
    const scope = await new OwnerOrGroupMemberAccessPolicy(reader).scopeFor(authOf(USER), 'write');

    expect(scope).toMatchObject({ userId: USER, action: 'write', groupIds: [] });
    expect(groupIdsOf).not.toHaveBeenCalled();
  });

  it('with the default reader, a read scope holds no groups', async () => {
    const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
    expect((await policy.scopeFor(authOf(USER), 'read')).groupIds).toEqual([]);
  });

  it('is the only way to obtain a scope (the type cannot be built by hand)', () => {
    // @ts-expect-error AccessScope carries a brand only the policy can set.
    const forged: AccessScope = { userId: USER, action: 'read', groupIds: [] };
    expect(forged.userId).toBe(USER);
  });

  it('types the scope by action: a read scope is not a write scope', async () => {
    const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
    const write: AccessScope<'write'> = await policy.scopeFor(authOf(USER), 'write');
    // @ts-expect-error A read scope cannot stand in for a write scope.
    const misused: AccessScope<'write'> = await policy.scopeFor(authOf(USER), 'read');
    expect([write.action, misused.action]).toEqual(['write', 'read']);
  });

  it('rejects spread forgeries at compile time and at run time', async () => {
    const { reader } = readerWith([GROUP_A]);
    const read = await new OwnerOrGroupMemberAccessPolicy(reader).scopeFor(authOf(USER), 'read');
    /* eslint-disable @typescript-eslint/no-misused-spread -- forging a scope is what this tests */
    // @ts-expect-error A spread copy loses the brand, so it is not an AccessScope.
    const victim: AccessScope<'read'> = { ...read, userId: randomUUID() };
    // @ts-expect-error Neither can a spread turn a read scope into a write scope.
    const upgraded: AccessScope<'write'> = { ...read, action: 'write' as const };

    expect(() => {
      assertIssuedScope(read);
    }).not.toThrow();
    const plainCopy = { ...read };
    /* eslint-enable @typescript-eslint/no-misused-spread */
    for (const forged of [victim, upgraded, plainCopy]) {
      expect(() => {
        assertIssuedScope(forged);
      }).toThrow('AccessScope was not issued by an AccessPolicy');
    }
  });

  it('issues frozen scopes', async () => {
    const { reader } = readerWith([GROUP_A]);
    const read = await new OwnerOrGroupMemberAccessPolicy(reader).scopeFor(authOf(USER), 'read');

    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.groupIds)).toBe(true);
    expect(Reflect.set(read, 'userId', randomUUID())).toBe(false);
    expect(read.userId).toBe(USER);
  });
});

describe('DenyAllGroupMembershipReader', () => {
  it('says the user belongs to no group', async () => {
    expect(await new DenyAllGroupMembershipReader().groupIdsOf(USER)).toEqual([]);
  });
});

describe('notFoundUnlessAllowed', () => {
  it('returns what the scoped query found', () => {
    const resource = { id: 'x' };
    expect(notFoundUnlessAllowed(resource)).toBe(resource);
  });

  it.each([null, undefined])('raises ResourceNotFound (404 NOT_FOUND) for %s', (missing) => {
    const error: unknown = (() => {
      try {
        return notFoundUnlessAllowed(missing);
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(ResourceNotFound);
    expect((error as AppError).code).toBe('NOT_FOUND');
  });
});

describe('requireVerifiedEmail', () => {
  function appWith(auth: AuthContext | undefined) {
    const app = express();
    app.get(
      '/financial',
      (req, _res, next) => {
        if (auth) req.auth = auth;
        next();
      },
      requireVerifiedEmail,
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    app.use(createErrorHandler(createLogger({ level: 'silent' })));
    return app;
  }

  it('answers 403 EMAIL_NOT_VERIFIED for an unverified user (AC-04)', async () => {
    const response = await request(appWith({ ...authOf(USER), emailVerified: false })).get(
      '/financial',
    );
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('lets a verified user through', async () => {
    const response = await request(appWith(authOf(USER))).get('/financial');
    expect(response.status).toBe(200);
  });

  it('answers 401 when no session middleware ran before it (fails closed)', async () => {
    const response = await request(appWith(undefined)).get('/financial');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED' });
  });
});
