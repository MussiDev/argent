import { and, asc, eq } from 'drizzle-orm';
import type { Portfolio, PortfolioRepository } from '../../application/ports';
import type { AccessScope } from '../../../shared/access';
import { scopedTo } from '../../../shared/access/infrastructure/drizzle-access-scope';
import { portfolios, type InvestmentsDb } from './schema';

const columns = {
  id: portfolios.id,
  name: portfolios.name,
  createdAt: portfolios.createdAt,
};

/** The scoped clause every statement uses: this row, and only if the scope covers it. */
function scopedRow(scope: AccessScope, id: string) {
  return and(eq(portfolios.id, id), scopedTo(scope, { owner: portfolios.ownerId }));
}

export class DrizzlePortfolioRepository implements PortfolioRepository {
  constructor(private readonly db: InvestmentsDb) {}

  async create(scope: AccessScope<'write'>, name: string): Promise<Portfolio> {
    const [row] = await this.db
      .insert(portfolios)
      .values({ ownerId: scope.userId, name })
      .returning(columns);
    if (row === undefined) throw new Error('portfolio insert returned no row');
    return row;
  }

  listForOwner(scope: AccessScope): Promise<Portfolio[]> {
    return this.db
      .select(columns)
      .from(portfolios)
      .where(scopedTo(scope, { owner: portfolios.ownerId }))
      .orderBy(asc(portfolios.createdAt), asc(portfolios.id));
  }

  async findById(scope: AccessScope, id: string): Promise<Portfolio | null> {
    const [row] = await this.db
      .select(columns)
      .from(portfolios)
      .where(scopedRow(scope, id))
      .limit(1);
    return row ?? null;
  }

  async lockById(scope: AccessScope<'write'>, id: string): Promise<Portfolio | null> {
    const [row] = await this.db
      .select(columns)
      .from(portfolios)
      .where(scopedRow(scope, id))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async delete(scope: AccessScope<'write'>, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(portfolios)
      .where(scopedRow(scope, id))
      .returning({ id: portfolios.id });
    return rows.length === 1;
  }
}
