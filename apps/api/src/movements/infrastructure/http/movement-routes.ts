import {
  createMovementRequestSchema,
  listMovementsQuerySchema,
  listMovementsResponseSchema,
  movementIdParamsSchema,
  movementResponseSchema,
} from '@pesly/shared';
import { Router } from 'express';
import type { RouterFactory } from '../../../app';
import {
  OwnerOrGroupMemberAccessPolicy,
  type AccessAction,
  type AccessPolicy,
  type AccessScope,
} from '../../../shared/access';
import { DenyAllGroupMembershipReader } from '../../../shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../../../shared/db/client';
import type { AuthContext } from '../../../shared/http/auth-context';
import { HttpError } from '../../../shared/http/error-handler';
import { requireVerifiedEmail } from '../../../shared/http/require-verified-email';
import { validate } from '../../../shared/http/validate';
import type { Logger } from '../../../shared/logging/logger';
import { CreateMovement } from '../../application/create-movement';
import { GetMovement } from '../../application/get-movement';
import { ListMovements } from '../../application/list-movements';
import type { Clock } from '../../application/ports/clock';
import { RecordManualMovement } from '../../application/record-manual-movement';
import { DrizzleAccountLookup } from '../db/drizzle-account-lookup';
import { DrizzleCategoryLookup } from '../db/drizzle-category-lookup';
import { DrizzleMovementRepository } from '../db/drizzle-movement-repository';
import { DrizzleMovementWriteLimiter } from '../db/drizzle-movement-write-limiter';
import { DrizzleRateLookup } from '../db/drizzle-rate-lookup';
import { DrizzleUserPreferences } from '../db/drizzle-user-preferences';
import { SystemClock } from '../system-clock';
import { presentMovement, presentMovementList } from './movement-presenter';

export interface MovementRoutesOptions {
  db: Database;
  /** Required so the audit trail cannot silently disappear. */
  logger: Logger;
  /** Manual creations per user per minute (default 60); the performance test raises it. */
  writeLimit?: number;
  /** Defaults to the system clock; tests inject one to cross the limiter windows. */
  clock?: Clock;
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

/** `/movements`: requireSession, requireVerifiedEmail, then scoped use cases. */
export function createMovementRoutes({
  db,
  logger,
  writeLimit,
  clock = new SystemClock(),
}: MovementRoutesOptions): RouterFactory {
  const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());
  const movements = new DrizzleMovementRepository(db);
  const createMovement = new CreateMovement({
    movements,
    accounts: new DrizzleAccountLookup(db),
    categories: new DrizzleCategoryLookup(db),
    rates: new DrizzleRateLookup(db),
    preferences: new DrizzleUserPreferences(db),
    clock,
  });
  const recordManualMovement = new RecordManualMovement(
    {
      createMovement,
      limiter: new DrizzleMovementWriteLimiter(db, clock),
      clock,
      // A failed refund only makes the limit stricter; it is logged without any request data.
      reportReleaseFailure: (error) => {
        logger.error({ err: error }, 'movement write limiter release failed');
      },
    },
    writeLimit,
  );
  const listMovements = new ListMovements({ movements });
  const getMovement = new GetMovement({ movements });

  return ({ requireSession }) => {
    const router = Router();
    router.use('/movements', requireSession, requireVerifiedEmail);

    router.post(
      '/movements',
      validate(
        { body: createMovementRequestSchema, response: movementResponseSchema },
        async ({ body }, { res, auth, requestId }) => {
          const scope = await scopeOf(policy, auth, 'write');
          const created = await recordManualMovement.execute(scope, {
            type: body.type,
            accountId: body.accountId,
            categoryId: body.categoryId,
            amount: BigInt(body.amount),
            occurredAt: new Date(body.occurredAt),
            ...(body.note === undefined ? {} : { note: body.note }),
            rate:
              body.rate.source === 'automatic'
                ? { source: 'automatic' }
                : { source: 'manual', value: BigInt(body.rate.value) },
          });
          // Ids only: never the amount, the note or the rate.
          logger.info(
            { requestId, userId: auth?.userId, movementId: created.id },
            'movement created',
          );
          res.status(201).json(presentMovement(created));
        },
      ),
    );

    router.get(
      '/movements',
      validate(
        { query: listMovementsQuerySchema, response: listMovementsResponseSchema },
        async ({ query }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentMovementList(await listMovements.execute(scope, query), query));
        },
      ),
    );

    router.get(
      '/movements/:id',
      validate(
        { params: movementIdParamsSchema, response: movementResponseSchema },
        async ({ params }, { res, auth }) => {
          const scope = await scopeOf(policy, auth, 'read');
          res.json(presentMovement(await getMovement.execute(scope, params.id)));
        },
      ),
    );

    return router;
  };
}
