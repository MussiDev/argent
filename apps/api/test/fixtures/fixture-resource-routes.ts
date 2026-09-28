import { Router } from 'express';
import { z } from 'zod';
import type { RouterFactory } from '../../src/app';
import {
  notFoundUnlessAllowed,
  OwnerOrGroupMemberAccessPolicy,
  ResourceNotFound,
  type AccessAction,
  type AccessPolicy,
  type AccessScope,
  type GroupMembershipReader,
} from '../../src/shared/access';
import { DenyAllGroupMembershipReader } from '../../src/shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../../src/shared/db/client';
import type { AuthContext } from '../../src/shared/http/auth-context';
import { HttpError } from '../../src/shared/http/error-handler';
import { requireVerifiedEmail } from '../../src/shared/http/require-verified-email';
import { validate } from '../../src/shared/http/validate';
import { FixtureResourceRepository } from './fixture-resource-repository';

// Test-only contract: these schemas stay out of packages/shared, which holds production contracts.
const fixtureParamsSchema = z.object({ id: z.uuid() });
const renameFixtureSchema = z.object({ name: z.string().min(1).max(50) });
const fixtureResponseSchema = z.object({ id: z.uuid(), name: z.string() });

export interface FixtureResourceRoutesOptions {
  db: Database;
  /** Defaults to the production default (nobody is a group member until PRD 05). */
  groupMembership?: GroupMembershipReader;
}

function scopeOf<A extends AccessAction>(
  policy: AccessPolicy,
  auth: AuthContext | undefined,
  action: A,
): Promise<AccessScope<A>> {
  // requireSession always sets auth before these routes; failing closed keeps that explicit.
  if (!auth) throw new HttpError(401, 'UNAUTHENTICATED');
  return policy.scopeFor(auth, action);
}

/**
 * A stand-in financial resource (`GET/PATCH/DELETE /test-fixtures/:id`) and the template for real
 * modules: requireSession, requireVerifiedEmail, a scope from the AccessPolicy, a repository that
 * requires it, and an empty result answered as 404. Mounted by `createApp` only when NODE_ENV is
 * `test`.
 */
export function fixtureResourceRoutes({
  db,
  groupMembership = new DenyAllGroupMembershipReader(),
}: FixtureResourceRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(groupMembership);
  const fixtures = new FixtureResourceRepository(db);
  return ({ requireSession }) => {
    const router = Router();
    router.use('/test-fixtures', requireSession, requireVerifiedEmail);

    router.get(
      '/test-fixtures/:id',
      validate(
        { params: fixtureParamsSchema, response: fixtureResponseSchema },
        async ({ params }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(notFoundUnlessAllowed(await fixtures.findById(scope, params.id)));
        },
      ),
    );

    router.patch(
      '/test-fixtures/:id',
      validate(
        { params: fixtureParamsSchema, body: renameFixtureSchema, response: fixtureResponseSchema },
        async ({ params, body }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'write');
          res.json(notFoundUnlessAllowed(await fixtures.rename(scope, params.id, body.name)));
        },
      ),
    );

    router.delete(
      '/test-fixtures/:id',
      validate({ params: fixtureParamsSchema }, async ({ params }, { res, auth }) => {
        const scope = await scopeOf(policy, auth, 'write');
        if (!(await fixtures.delete(scope, params.id))) throw new ResourceNotFound();
        res.sendStatus(204);
      }),
    );

    return router;
  };
}
