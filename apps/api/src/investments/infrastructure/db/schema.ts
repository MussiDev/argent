import {
  INSTRUMENT_NAME_MAX_LENGTH,
  INSTRUMENT_TYPES,
  PORTFOLIO_NAME_MAX_LENGTH,
  PRICE_SOURCES,
  QUANTITY_MAX,
  TICKER_MAX_LENGTH,
  TOTAL_COST_MAX,
  UNIT_PRICE_MAX,
  VALUATION_CURRENCIES,
} from '@pesly/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
  type PgDatabase,
} from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
// Deliberate read-only import across modules: `users` is only the target of a foreign key.
import { users } from '../../../identity/infrastructure/db/schema';

/** The database or an open transaction: repositories accept either so use cases can compose them. */
export type InvestmentsDb = PgDatabase<NodePgQueryResultHKT>;

/**
 * `column in ('a', 'b')` for check constraints. Values are inlined as literals because drizzle-kit
 * cannot bind parameters in DDL; they come from compile-time constants, never from input.
 */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql`${column} in (${sql.raw(literals)})`;
}

/** `column > 0 and column <= max`; the bound is a compile-time bigint constant, inlined for DDL. */
function between1And(column: AnyPgColumn, max: bigint): SQL {
  return sql`${column} > 0 and ${column} <= ${sql.raw(max.toString())}`;
}

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const HOLDINGS_PORTFOLIO_TICKER_KEY = 'holdings_portfolio_ticker_key';

export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    check(
      'portfolios_name_length_check',
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(PORTFOLIO_NAME_MAX_LENGTH))}`,
    ),
    // The target of the composite foreign key of `holdings`.
    unique('portfolios_id_owner_id_key').on(table.id, table.ownerId),
    index('portfolios_owner_id_idx').on(table.ownerId),
  ],
);

export const holdings = pgTable(
  'holdings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portfolioId: uuid('portfolio_id').notNull(),
    ownerId: uuid('owner_id').notNull(),
    ticker: text('ticker').notNull(),
    instrumentName: text('instrument_name').notNull(),
    instrumentType: text('instrument_type', { enum: INSTRUMENT_TYPES }).notNull(),
    /** Scaled by 10^8; `bigint` mode, because a JavaScript number loses precision above 2^53. */
    quantity: bigint('quantity', { mode: 'bigint' }).notNull(),
    valuationCurrency: text('valuation_currency', { enum: VALUATION_CURRENCIES }).notNull(),
    /** Minor units of the valuation currency. */
    totalCost: bigint('total_cost', { mode: 'bigint' }),
    /** Minor units; the three price columns are all null or all set. */
    unitPrice: bigint('unit_price', { mode: 'bigint' }),
    priceSource: text('price_source', { enum: PRICE_SOURCES }),
    pricedAt: timestamptz('priced_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // A holding can never carry another owner than its portfolio.
    foreignKey({
      name: 'holdings_portfolio_owner_fk',
      columns: [table.portfolioId, table.ownerId],
      foreignColumns: [portfolios.id, portfolios.ownerId],
    }).onDelete('cascade'),
    check(
      'holdings_ticker_length_check',
      sql`char_length(${table.ticker}) between 1 and ${sql.raw(String(TICKER_MAX_LENGTH))}`,
    ),
    check(
      'holdings_instrument_name_length_check',
      sql`char_length(${table.instrumentName}) between 1 and ${sql.raw(String(INSTRUMENT_NAME_MAX_LENGTH))}`,
    ),
    check('holdings_instrument_type_check', oneOf(table.instrumentType, INSTRUMENT_TYPES)),
    check(
      'holdings_valuation_currency_check',
      oneOf(table.valuationCurrency, VALUATION_CURRENCIES),
    ),
    check('holdings_quantity_check', between1And(table.quantity, QUANTITY_MAX)),
    check(
      'holdings_total_cost_check',
      sql`${table.totalCost} is null or (${between1And(table.totalCost, TOTAL_COST_MAX)})`,
    ),
    check(
      'holdings_unit_price_check',
      sql`${table.unitPrice} is null or (${between1And(table.unitPrice, UNIT_PRICE_MAX)})`,
    ),
    check(
      'holdings_price_source_check',
      sql`${table.priceSource} is null or (${oneOf(table.priceSource, PRICE_SOURCES)})`,
    ),
    check(
      'holdings_price_all_or_none_check',
      sql`(${table.unitPrice} is null and ${table.priceSource} is null and ${table.pricedAt} is null) or (${table.unitPrice} is not null and ${table.priceSource} is not null and ${table.pricedAt} is not null)`,
    ),
    check(
      'holdings_crypto_usd_check',
      sql`${table.instrumentType} <> 'crypto' or ${table.valuationCurrency} = 'USD'`,
    ),
    uniqueIndex(HOLDINGS_PORTFOLIO_TICKER_KEY).on(table.portfolioId, sql`lower(${table.ticker})`),
    index('holdings_owner_id_idx').on(table.ownerId),
  ],
);
