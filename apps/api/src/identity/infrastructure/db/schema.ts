import { RATE_TYPES } from '@argent/shared';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
  type PgDatabase,
} from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { DISPLAY_CURRENCIES, LANGUAGES } from '../../domain/account-defaults';
import { ATTEMPT_KINDS } from '../../application/ports/attempt-limiter';
import { OUTBOX_EMAIL_KINDS } from '../../application/ports/email-sender';
import { ONE_TIME_TOKEN_PURPOSES } from '../../application/ports/one-time-token-repository';

/** The database or an open transaction: repositories accept either so use cases can compose them. */
export type IdentityDb = PgDatabase<NodePgQueryResultHKT>;

/** What an outbox row carries besides its columns: never a token or any other secret (R-05). */
export interface OutboxPayload {
  userId: string | null;
}

/**
 * `column in ('a', 'b')` for check constraints. Values are inlined as literals because drizzle-kit
 * cannot bind parameters in DDL; they come from compile-time constants, never from input.
 */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql`${column} in (${sql.raw(literals)})`;
}

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: timestamptz('email_verified_at'),
    defaultRateType: text('default_rate_type', { enum: RATE_TYPES }).notNull().default('mep'),
    displayCurrency: text('display_currency', { enum: DISPLAY_CURRENCIES })
      .notNull()
      .default('ARS'),
    timeZone: text('time_zone').notNull(),
    language: text('language', { enum: LANGUAGES }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** Bumped by every password change; sessions created with an older value are dead (AC-10). */
    credentialsVersion: integer('credentials_version').notNull().default(0),
    passwordChangedAt: timestamptz('password_changed_at'),
  },
  (table) => [
    check('users_default_rate_type_check', oneOf(table.defaultRateType, RATE_TYPES)),
    check('users_display_currency_check', oneOf(table.displayCurrency, DISPLAY_CURRENCIES)),
    check('users_language_check', oneOf(table.language, LANGUAGES)),
  ],
);

export const oneTimeTokens = pgTable(
  'one_time_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: ONE_TIME_TOKEN_PURPOSES }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    check('one_time_tokens_purpose_check', oneOf(table.purpose, ONE_TIME_TOKEN_PURPOSES)),
    index('one_time_tokens_user_id_purpose_idx').on(table.userId, table.purpose),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    lastUsedAt: timestamptz('last_used_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    replacedBy: uuid('replaced_by'),
    /** The user's credentials version when the session (or its family's first one) was created. */
    credentialsVersion: integer('credentials_version').notNull().default(0),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_family_id_idx').on(table.familyId),
  ],
);

export const authAttempts = pgTable(
  'auth_attempts',
  {
    key: text('key').notNull(),
    kind: text('kind', { enum: ATTEMPT_KINDS }).notNull(),
    windowStart: timestamptz('window_start').notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.key, table.windowStart] }),
    check('auth_attempts_kind_check', oneOf(table.kind, ATTEMPT_KINDS)),
    // The primary key leads with `kind`, so the worker's purge by age needs its own index.
    index('auth_attempts_window_start_idx').on(table.windowStart),
  ],
);

export const emailOutbox = pgTable(
  'email_outbox',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind', { enum: OUTBOX_EMAIL_KINDS }).notNull(),
    toEmail: text('to_email'),
    language: text('language', { enum: LANGUAGES }).notNull(),
    payload: jsonb('payload').$type<OutboxPayload>().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    sentAt: timestamptz('sent_at'),
    attempts: integer('attempts').notNull().default(0),
    /** When a failed row may be tried again; null means due now. Shared by every worker. */
    nextAttemptAt: timestamptz('next_attempt_at'),
  },
  (table) => [
    check('email_outbox_kind_check', oneOf(table.kind, OUTBOX_EMAIL_KINDS)),
    check('email_outbox_language_check', oneOf(table.language, LANGUAGES)),
    // Workers poll pending rows oldest first.
    index('email_outbox_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.sentAt} is null`),
  ],
);
