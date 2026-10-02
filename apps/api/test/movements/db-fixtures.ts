import { randomUUID } from 'node:crypto';
import type { CategoryKind } from '@pesly/shared';
import type pg from 'pg';
import { Email } from '../../src/identity/domain/email';
import { DrizzleUserRepository } from '../../src/identity/infrastructure/db/drizzle-user-repository';
import { OwnerOrGroupMemberAccessPolicy, type AccessScope } from '../../src/shared/access';
import { DenyAllGroupMembershipReader } from '../../src/shared/access/infrastructure/deny-all-group-membership-reader';
import type { Database } from '../../src/shared/db/client';

const policy = new OwnerOrGroupMemberAccessPolicy(new DenyAllGroupMembershipReader());

export function writeScope(userId: string): Promise<AccessScope<'write'>> {
  return policy.scopeFor({ userId, sessionId: 's', emailVerified: true }, 'write');
}

export function readScope(userId: string): Promise<AccessScope<'read'>> {
  return policy.scopeFor({ userId, sessionId: 's', emailVerified: true }, 'read');
}

function firstId(rows: { id: string }[]): string {
  const row = rows[0];
  if (!row) throw new Error('The insert returned no row');
  return row.id;
}

export async function newUserId(
  db: Database,
  options: { timeZone?: string; rateType?: 'mep' | 'blue' | 'oficial' } = {},
): Promise<string> {
  const user = await new DrizzleUserRepository(db).create({
    email: Email.parse(`u-${randomUUID()}@example.com`),
    passwordHash: 'h',
    defaultRateType: options.rateType ?? 'mep',
    displayCurrency: 'ARS',
    timeZone: options.timeZone ?? 'America/Cordoba',
    language: 'es',
  });
  return user.id;
}

export async function newAccount(
  pool: pg.Pool,
  ownerId: string,
  archived = false,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into accounts (owner_id, name, type, currency, opening_balance, include_in_available, archived_at)
     values ($1, $2, 'cash', 'ARS', 0, true, $3) returning id`,
    [ownerId, `Caja ${randomUUID()}`, archived ? new Date() : null],
  );
  return firstId(result.rows);
}

export async function newCategory(
  pool: pg.Pool,
  ownerId: string,
  kind: CategoryKind,
  archived = false,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into categories (owner_id, kind, name, icon, color, archived_at)
     values ($1, $2, $3, 'tag', 'blue', $4) returning id`,
    [ownerId, kind, `Cat ${randomUUID()}`, archived ? new Date() : null],
  );
  return firstId(result.rows);
}

export async function newMovement(
  pool: pg.Pool,
  fixture: {
    ownerId: string;
    accountId: string;
    categoryId: string;
    type: CategoryKind;
    amount: bigint;
  },
): Promise<void> {
  await pool.query(
    `insert into movements (owner_id, type, account_id, category_id, amount, occurred_at, rate, rate_source)
     values ($1, $2, $3, $4, $5, now(), 14000000, 'manual')`,
    [
      fixture.ownerId,
      fixture.type,
      fixture.accountId,
      fixture.categoryId,
      fixture.amount.toString(),
    ],
  );
}
