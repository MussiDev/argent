import { and, count, eq, sql } from 'drizzle-orm';
import type { MovementRepository } from '../../application/ports/movement-repository';
import type { Movement, NewMovement } from '../../domain/movement';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import { ResourceNotFound } from '../../../shared/access/not-found-unless-allowed';
import type { Database } from '../../../shared/db/client';
import { violatedConstraint } from '../../../shared/db/pg-errors';
import { movements } from './schema';

const ACCOUNT_KEY = 'movements_account_owner_fk';
const CATEGORY_KEY = 'movements_category_owner_kind_fk';

const columns = {
  id: movements.id,
  ownerId: movements.ownerId,
  type: movements.type,
  accountId: movements.accountId,
  categoryId: movements.categoryId,
  amount: movements.amount,
  occurredAt: movements.occurredAt,
  note: movements.note,
  rate: movements.rate,
  rateSource: movements.rateSource,
  rateType: movements.rateType,
  createdAt: movements.createdAt,
};

const inScope = (scope: AccessScope) => scopedTo(scope, { owner: movements.ownerId });

/**
 * An account or category that vanished between the read and the insert is a not-found, never a
 * 500. Any other violation (the key to users, a check) is rethrown as it is.
 */
function asNotFound(error: unknown): unknown {
  const key = violatedConstraint(error, '23503');
  return key === ACCOUNT_KEY || key === CATEGORY_KEY ? new ResourceNotFound() : error;
}

/** The list statement, exposed so a test can ask the planner about it. */
export function listMovementsQuery(
  db: Database,
  scope: AccessScope,
  options: { limit: number; offset: number },
) {
  return (
    db
      .select(columns)
      .from(movements)
      .where(inScope(scope))
      // Same direction and null placement as movements_owner_date_idx, so the planner needs no sort.
      .orderBy(sql`${movements.occurredAt} desc nulls last`, sql`${movements.id} desc nulls last`)
      .limit(options.limit)
      .offset(options.offset)
  );
}

export class DrizzleMovementRepository implements MovementRepository {
  constructor(private readonly db: Database) {}

  async insert(scope: AccessScope<'write'>, data: NewMovement): Promise<Movement> {
    try {
      const [row] = await this.db
        .insert(movements)
        // Fields are picked one by one: a loosely typed caller cannot smuggle id or timestamps.
        .values({
          ownerId: scope.userId,
          type: data.type,
          accountId: data.accountId,
          categoryId: data.categoryId,
          amount: data.amount,
          occurredAt: data.occurredAt,
          // A note that is empty after trimming carries no information.
          note: data.note === null || data.note.trim() === '' ? null : data.note,
          rate: data.rate,
          rateSource: data.rateSource,
          rateType: data.rateType,
        })
        .returning(columns);
      if (!row) throw new Error('Inserting a movement returned no row');
      return row;
    } catch (error) {
      throw asNotFound(error);
    }
  }

  async list(
    scope: AccessScope,
    options: { limit: number; offset: number },
  ): Promise<{ items: Movement[]; total: number }> {
    const where = inScope(scope);
    const items = await listMovementsQuery(this.db, scope, options);
    const [totalRow] = await this.db.select({ total: count() }).from(movements).where(where);
    return { items, total: totalRow?.total ?? 0 };
  }

  async findById(scope: AccessScope, id: string): Promise<Movement | null> {
    const [row] = await this.db
      .select(columns)
      .from(movements)
      .where(and(eq(movements.id, id), inScope(scope)))
      .limit(1);
    return row ?? null;
  }
}
