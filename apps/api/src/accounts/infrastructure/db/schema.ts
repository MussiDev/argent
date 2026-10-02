import { ACCOUNT_CURRENCIES, ACCOUNT_TYPES } from '@pesly/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
// The foreign-key target is imported from the identity schema because drizzle-kit needs the
// reference to resolve.
import { users } from '../../../identity/infrastructure/db/schema';

/**
 * `column in ('a', 'b')` for check constraints. Values are inlined as literals because drizzle-kit
 * cannot bind parameters in DDL; they come from compile-time constants, never from input.
 */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql`${column} in (${sql.raw(literals)})`;
}

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type', { enum: ACCOUNT_TYPES }).notNull(),
    currency: text('currency', { enum: ACCOUNT_CURRENCIES }).notNull(),
    /** Signed minor units. */
    openingBalance: bigint('opening_balance', { mode: 'bigint' }).notNull(),
    /** Whether the balance counts toward the available total; no default, the use case chooses (FEAT-003). */
    includeInAvailable: boolean('include_in_available').notNull(),
    archivedAt: timestamptz('archived_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // Mirrors the request validation (1 to 50 characters) as defence in depth (NFR-05).
    check('accounts_name_length_check', sql`char_length(${table.name}) between 1 and 50`),
    // Second line of defence behind the shared schema: |opening balance| <= 10^15 minor units (Q8).
    check(
      'accounts_opening_balance_range_check',
      sql`${table.openingBalance} between -1000000000000000 and 1000000000000000`,
    ),
    check('accounts_type_check', oneOf(table.type, ACCOUNT_TYPES)),
    check('accounts_currency_check', oneOf(table.currency, ACCOUNT_CURRENCIES)),
    // A credit card is debt, never available money (FEAT-003 FR-05).
    check(
      'accounts_credit_card_not_available_check',
      sql`${table.type} <> 'credit_card' or ${table.includeInAvailable} = false`,
    ),
    uniqueIndex('accounts_owner_name_unique').on(table.ownerId, sql`lower(${table.name})`),
    index('accounts_owner_created_idx').on(table.ownerId, table.createdAt, table.id),
  ],
);
