import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const ALL_MIGRATIONS = 5;
const TABLES_BEFORE_0004 = [
  'auth_attempts',
  'email_outbox',
  'one_time_tokens',
  'sessions',
  'users',
];
const IDENTITY_TABLES = [
  'auth_attempts',
  'email_outbox',
  'oauth_states',
  'one_time_tokens',
  'sessions',
  'user_identities',
  'users',
];

/** A throwaway database next to the test database, so the migration runs on a truly empty one. */
const emptyDatabaseUrl = (() => {
  const url = new URL(testDatabaseUrl);
  url.pathname = '/argent_migration_test';
  return url.toString();
})();

/**
 * Empties the throwaway database by dropping its schemas instead of the database itself: in
 * PostgreSQL 16 `drop database` waits for a checkpoint, which after a full test run flushes many
 * dirty buffers and could exceed the hook timeout (the flake this replaced).
 */
async function emptyTheDatabase(target: pg.Client): Promise<void> {
  await target.query('drop schema if exists drizzle cascade');
  await target.query('drop schema if exists public cascade');
  await target.query('create schema public');
}

/** Schema resets take milliseconds; the explicit timeout only guards a slow shared server. */
const HOOK_TIMEOUT_MS = 30_000;

let client: pg.Client;

beforeAll(async () => {
  await ensureTestDatabase(emptyDatabaseUrl);
  client = new pg.Client({ connectionString: emptyDatabaseUrl });
  await client.connect();
  await emptyTheDatabase(client);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await emptyTheDatabase(client);
  await client.end();
}, HOOK_TIMEOUT_MS);

async function publicTables(): Promise<string[]> {
  const result = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  return result.rows.map((row) => row.tablename);
}

async function sqlState(statement: string): Promise<string | undefined> {
  try {
    await client.query(statement);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

function rollback(tag: string): Promise<string> {
  return readFile(`${migrationsFolder}/rollback/${tag}.down.sql`, 'utf8');
}

async function appliedMigrations(): Promise<number> {
  const result = await client.query<{ n: string }>(
    'select count(*) as n from drizzle.__drizzle_migrations',
  );
  return Number(result.rows[0]?.n);
}

async function indexDefinition(name: string): Promise<string | undefined> {
  const result = await client.query<{ indexdef: string }>(
    "select indexdef from pg_indexes where schemaname = 'public' and indexname = $1",
    [name],
  );
  return result.rows[0]?.indexdef;
}

describe('0000_identity migration', () => {
  it('applies on an empty database and creates the identity tables', async () => {
    expect(await publicTables()).toEqual([]);

    await runMigrations(emptyDatabaseUrl);

    expect(await publicTables()).toEqual(IDENTITY_TABLES);
  });

  it('creates the listed defaults, constraints and indexes', async () => {
    const inserted = await client.query<{
      id: string;
      default_rate_type: string;
      display_currency: string;
    }>(
      "insert into users (email, password_hash, time_zone, language) values ('ana@example.com', 'h', 'America/Cordoba', 'es') returning id, default_rate_type, display_currency",
    );
    const user = inserted.rows[0];
    expect(user).toMatchObject({ default_rate_type: 'mep', display_currency: 'ARS' });
    const userId = user?.id ?? '';

    // unique email
    expect(
      await sqlState(
        "insert into users (email, password_hash, time_zone, language) values ('ana@example.com', 'h', 'UTC', 'es')",
      ),
    ).toBe('23505');
    // check constraints
    for (const values of [
      "('x1@example.com', 'h', 'UTC', 'pt', 'mep', 'ARS')",
      "('x2@example.com', 'h', 'UTC', 'es', 'euro', 'ARS')",
      "('x3@example.com', 'h', 'UTC', 'es', 'mep', 'EUR')",
    ]) {
      expect(
        await sqlState(
          `insert into users (email, password_hash, time_zone, language, default_rate_type, display_currency) values ${values}`,
        ),
      ).toBe('23514');
    }
    expect(
      await sqlState(
        `insert into one_time_tokens (id, user_id, purpose, token_hash, expires_at) values (gen_random_uuid(), '${userId}', 'login', 'h', now())`,
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        "insert into auth_attempts (key, kind, window_start) values ('k', 'other', now())",
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'spam', 'es', '{}')",
      ),
    ).toBe('23514');
    // foreign keys cascade on user deletion
    await client.query(
      `insert into one_time_tokens (id, user_id, purpose, token_hash, expires_at) values (gen_random_uuid(), '${userId}', 'email_verification', 't1', now())`,
    );
    await client.query(
      `insert into sessions (id, user_id, family_id, refresh_token_hash, last_used_at) values (gen_random_uuid(), '${userId}', gen_random_uuid(), 'r1', now())`,
    );
    await client.query(`delete from users where id = '${userId}'`);
    const leftovers = await client.query(
      'select (select count(*) from one_time_tokens) + (select count(*) from sessions) as n',
    );
    expect(Number((leftovers.rows[0] as { n: string }).n)).toBe(0);

    const indexes = await client.query<{ indexname: string; indexdef: string }>(
      "select indexname, indexdef from pg_indexes where schemaname = 'public'",
    );
    const definitions = indexes.rows.map((row) => row.indexdef);
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/UNIQUE INDEX \S+ ON public\.users USING btree \(email\)/),
        expect.stringMatching(
          /UNIQUE INDEX \S+ ON public\.one_time_tokens USING btree \(token_hash\)/,
        ),
        expect.stringMatching(
          /INDEX \S+ ON public\.one_time_tokens USING btree \(user_id, purpose\)/,
        ),
        expect.stringMatching(
          /UNIQUE INDEX \S+ ON public\.sessions USING btree \(refresh_token_hash\)/,
        ),
        expect.stringMatching(/INDEX \S+ ON public\.sessions USING btree \(user_id\)/),
        expect.stringMatching(/INDEX \S+ ON public\.sessions USING btree \(family_id\)/),
        expect.stringMatching(
          /UNIQUE INDEX \S+ ON public\.auth_attempts USING btree \(kind, key, window_start\)/,
        ),
        expect.stringMatching(
          /INDEX \S+ ON public\.email_outbox USING btree \(created_at\) WHERE \(sent_at IS NULL\)/,
        ),
      ]),
    );
  });

  it('is reverted by the rollback scripts (newest first), after which it can be applied again', async () => {
    await client.query(await rollback('0004_google_identity'));
    await client.query(await rollback('0003_outbox_retry'));
    await client.query(await rollback('0002_credentials_version'));
    await client.query(await rollback('0001_outbox_hardening'));
    await client.query(await rollback('0000_identity'));
    expect(await publicTables()).toEqual([]);
    expect(await appliedMigrations()).toBe(0);

    await runMigrations(emptyDatabaseUrl);
    expect(await publicTables()).toEqual(IDENTITY_TABLES);
  });
});

describe('0001_outbox_hardening migration', () => {
  it('adds the auth_attempts(window_start) index and the email_outbox language check', async () => {
    expect(await indexDefinition('auth_attempts_window_start_idx')).toMatch(
      /^CREATE INDEX auth_attempts_window_start_idx ON public\.auth_attempts USING btree \(window_start\)$/,
    );
    expect(
      await sqlState(
        "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'discard', 'pt', '{}')",
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'discard', 'en', '{\"userId\": null}')",
      ),
    ).toBeUndefined();
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });

  it('is reverted by its rollback script (after the newer ones), leaving 0000 in place, and re-applies', async () => {
    await client.query('delete from email_outbox');
    // Newest first: drizzle only applies migrations newer than the last one recorded.
    await client.query(await rollback('0004_google_identity'));
    await client.query(await rollback('0003_outbox_retry'));
    await client.query(await rollback('0002_credentials_version'));
    await client.query(await rollback('0001_outbox_hardening'));

    expect(await indexDefinition('auth_attempts_window_start_idx')).toBeUndefined();
    expect(
      await sqlState(
        "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'discard', 'pt', '{}')",
      ),
    ).toBeUndefined();
    expect(await publicTables()).toEqual(TABLES_BEFORE_0004);
    expect(await appliedMigrations()).toBe(1);

    await client.query('delete from email_outbox');
    await runMigrations(emptyDatabaseUrl);
    expect(await indexDefinition('auth_attempts_window_start_idx')).toBeDefined();
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });
});

interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function credentialsColumns(): Promise<ColumnInfo[]> {
  const result = await client.query<ColumnInfo>(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public'
        and column_name in ('credentials_version', 'password_changed_at')
      order by table_name, column_name`,
  );
  return result.rows;
}

describe('0002_credentials_version migration', () => {
  it('adds users.credentials_version, users.password_changed_at and sessions.credentials_version', async () => {
    expect(await credentialsColumns()).toEqual([
      {
        table_name: 'sessions',
        column_name: 'credentials_version',
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: '0',
      },
      {
        table_name: 'users',
        column_name: 'credentials_version',
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: '0',
      },
      {
        table_name: 'users',
        column_name: 'password_changed_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
    const inserted = await client.query<{
      id: string;
      credentials_version: number;
      password_changed_at: Date | null;
    }>(
      "insert into users (email, password_hash, time_zone, language) values ('cv@example.com', 'h', 'UTC', 'es') returning id, credentials_version, password_changed_at",
    );
    expect(inserted.rows[0]).toMatchObject({ credentials_version: 0, password_changed_at: null });
    const session = await client.query<{ credentials_version: number }>(
      `insert into sessions (id, user_id, family_id, refresh_token_hash, last_used_at) values (gen_random_uuid(), '${inserted.rows[0]?.id ?? ''}', gen_random_uuid(), 'cv1', now()) returning credentials_version`,
    );
    expect(session.rows).toEqual([{ credentials_version: 0 }]);
  });

  it('is reverted by its rollback script (after the newer ones), keeping the data of the older columns, and re-applies', async () => {
    await client.query(await rollback('0004_google_identity'));
    await client.query(await rollback('0003_outbox_retry'));
    await client.query(await rollback('0002_credentials_version'));

    expect(await credentialsColumns()).toEqual([]);
    expect(await publicTables()).toEqual(TABLES_BEFORE_0004);
    expect(await appliedMigrations()).toBe(2);
    const kept = await client.query("select 1 from users where email = 'cv@example.com'");
    expect(kept.rowCount).toBe(1);

    await runMigrations(emptyDatabaseUrl);
    expect(await credentialsColumns()).toHaveLength(3);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });
});

async function nextAttemptColumn(): Promise<ColumnInfo[]> {
  const result = await client.query<ColumnInfo>(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and column_name = 'next_attempt_at'`,
  );
  return result.rows;
}

async function outboxIndexes(): Promise<string[]> {
  const result = await client.query<{ indexdef: string }>(
    "select indexdef from pg_indexes where schemaname = 'public' and tablename = 'email_outbox' and indexname <> 'email_outbox_pkey' order by indexname",
  );
  return result.rows.map((row) => row.indexdef);
}

const PENDING_BY_CREATED_AT =
  'CREATE INDEX email_outbox_pending_idx ON public.email_outbox USING btree (created_at) WHERE (sent_at IS NULL)';
const PENDING_BY_SENT_AT =
  'CREATE INDEX email_outbox_pending_idx ON public.email_outbox USING btree (sent_at) WHERE (sent_at IS NULL)';

describe('0003_outbox_retry migration', () => {
  it('adds a nullable email_outbox.next_attempt_at without default and indexes pending rows by created_at', async () => {
    expect(await nextAttemptColumn()).toEqual([
      {
        table_name: 'email_outbox',
        column_name: 'next_attempt_at',
        data_type: 'timestamp with time zone',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
    expect(await outboxIndexes()).toEqual([PENDING_BY_CREATED_AT]);
    const inserted = await client.query<{ next_attempt_at: Date | null }>(
      "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'discard', 'es', '{\"userId\": null}') returning next_attempt_at",
    );
    expect(inserted.rows).toEqual([{ next_attempt_at: null }]);
  });

  it('is reverted by its rollback script (after the newer one), restoring the previous index and keeping the rows, and re-applies', async () => {
    await client.query(await rollback('0004_google_identity'));
    await client.query(await rollback('0003_outbox_retry'));

    expect(await nextAttemptColumn()).toEqual([]);
    expect(await outboxIndexes()).toEqual([PENDING_BY_SENT_AT]);
    expect(await publicTables()).toEqual(TABLES_BEFORE_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 2);
    const kept = await client.query("select 1 from email_outbox where kind = 'discard'");
    expect(kept.rowCount).toBe(1);

    await runMigrations(emptyDatabaseUrl);
    expect(await nextAttemptColumn()).toHaveLength(1);
    expect(await outboxIndexes()).toEqual([PENDING_BY_CREATED_AT]);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });
});

async function passwordHashNullable(): Promise<string | undefined> {
  const result = await client.query<{ is_nullable: string }>(
    "select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'password_hash'",
  );
  return result.rows[0]?.is_nullable;
}

async function countOf(statement: string): Promise<number> {
  const result = await client.query<{ n: string }>(statement);
  return Number(result.rows[0]?.n);
}

describe('0004_google_identity migration', () => {
  it('applies on a database at 0003: password_hash nullable, user_identities, oauth_states and the google_start_ip kind', async () => {
    await client.query(await rollback('0004_google_identity'));
    expect(await publicTables()).toEqual(TABLES_BEFORE_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 1);

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(IDENTITY_TABLES);
    expect(await passwordHashNullable()).toBe('YES');
    const inserted = await client.query<{ id: string }>(
      "insert into users (email, time_zone, language, email_verified_at) values ('google@gmail.com', 'UTC', 'es', now()) returning id",
    );
    const userId = inserted.rows[0]?.id ?? '';
    const other = await client.query<{ id: string }>(
      "insert into users (email, password_hash, time_zone, language) values ('other@gmail.com', 'h', 'UTC', 'es') returning id",
    );
    const otherId = other.rows[0]?.id ?? '';
    expect(
      await sqlState(
        "insert into auth_attempts (key, kind, window_start) values ('ip', 'google_start_ip', now())",
      ),
    ).toBeUndefined();

    // user_identities: provider check, both unique constraints, cascade on user deletion
    const link = (user: string, provider: string, subject: string) =>
      sqlState(
        `insert into user_identities (user_id, provider, subject, email_authoritative) values ('${user}', '${provider}', '${subject}', true)`,
      );
    expect(await link(userId, 'google', 's1')).toBeUndefined();
    expect(await link(otherId, 'google', 's2')).toBeUndefined();
    expect(await link(otherId, 'apple', 's3')).toBe('23514');
    expect(await link(otherId, 'google', 's1')).toBe('23505');
    expect(await link(userId, 'google', 's4')).toBe('23505');
    await client.query(`delete from users where id = '${otherId}'`);
    expect(await countOf('select count(*) as n from user_identities')).toBe(1);

    // oauth_states: language check and the purge index on expires_at
    expect(
      await sqlState(
        "insert into oauth_states (state_hash, binding_hash, nonce_hash, code_verifier, time_zone, language, expires_at) values ('s', 'b', 'n', 'v', 'UTC', 'pt', now())",
      ),
    ).toBe('23514');
    expect(await indexDefinition('oauth_states_expires_at_idx')).toBe(
      'CREATE INDEX oauth_states_expires_at_idx ON public.oauth_states USING btree (expires_at)',
    );
  });

  it('has a rollback that fails while a password-less user exists, changing nothing', async () => {
    expect(await countOf('select count(*) as n from users where password_hash is null')).toBe(1);

    expect(await sqlState(await rollback('0004_google_identity'))).toBe('23502');

    expect(await publicTables()).toEqual(IDENTITY_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(
      await countOf("select count(*) as n from auth_attempts where kind = 'google_start_ip'"),
    ).toBe(1);
  });

  it('is reverted by its rollback when no password-less user exists, removing google_start_ip rows, and re-applies', async () => {
    await client.query('delete from users where password_hash is null');
    await client.query(
      "insert into auth_attempts (key, kind, window_start) values ('ip', 'sign_in_ip', now())",
    );

    await client.query(await rollback('0004_google_identity'));

    expect(await publicTables()).toEqual(TABLES_BEFORE_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 1);
    expect(await passwordHashNullable()).toBe('NO');
    expect(
      await countOf("select count(*) as n from auth_attempts where kind = 'google_start_ip'"),
    ).toBe(0);
    expect(await countOf("select count(*) as n from auth_attempts where kind = 'sign_in_ip'")).toBe(
      1,
    );
    expect(
      await sqlState(
        "insert into auth_attempts (key, kind, window_start) values ('ip2', 'google_start_ip', now())",
      ),
    ).toBe('23514');
    expect(await countOf("select count(*) as n from users where email = 'cv@example.com'")).toBe(1);

    await runMigrations(emptyDatabaseUrl);
    expect(await publicTables()).toEqual(IDENTITY_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });
});
