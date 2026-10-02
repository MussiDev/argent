import { eq, inArray, sql } from 'drizzle-orm';
import type { AccountMovements } from '../../../accounts/application/ports/account-movements';
import type { Database } from '../../../shared/db/client';
import { movements } from '../db/schema';

const CHUNK_SIZE = 500;

/**
 * UNSCOPED BY DESIGN (see the port): every result is keyed by the ids it was given, and rows of
 * other accounts are never selected.
 */
class DrizzleAccountMovements implements AccountMovements {
  constructor(private readonly db: Database) {}

  async sumsByAccount(accountIds: readonly string[]): Promise<ReadonlyMap<string, bigint>> {
    const sums = new Map<string, bigint>();
    for (let start = 0; start < accountIds.length; start += CHUNK_SIZE) {
      const chunk = accountIds.slice(start, start + CHUNK_SIZE);
      // `sum(bigint)` is numeric: cast to text so the exact value reaches BigInt.
      const rows = await this.db
        .select({
          accountId: movements.accountId,
          total: sql<string>`sum(case ${movements.type} when 'income' then ${movements.amount} else -${movements.amount} end)::text`,
        })
        .from(movements)
        .where(inArray(movements.accountId, chunk))
        .groupBy(movements.accountId);
      for (const row of rows) sums.set(row.accountId, BigInt(row.total));
    }
    return sums;
  }

  async hasMovements(accountId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(movements)
      .where(eq(movements.accountId, accountId))
      .limit(1);
    return row !== undefined;
  }
}

export function createAccountMovements(db: Database): AccountMovements {
  return new DrizzleAccountMovements(db);
}
