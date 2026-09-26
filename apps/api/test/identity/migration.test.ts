import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const IDENTITY_TABLES = ['auth_attempts', 'email_outbox', 'one_time_tokens', 'sessions', 'users'];

/** A throwaway database next to the test database, so the migration runs on a truly empty one. */
const emptyDatabaseUrl = (() => {
  const url = new URL(testDatabaseUrl);
  url.pathname = '/argent_migration_test';
  return url.toString();
})();

async function withAdmin<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function dropEmptyDatabase(): Promise<void> {
  await withAdmin((client) =>
    client.query('drop database if exists argent_migration_test with (force)'),
  );
}

let client: pg.Client;

beforeAll(async () => {
  await dropEmptyDatabase();
  await ensureTestDatabase(emptyDatabaseUrl);
  client = new pg.Client({ connectionString: emptyDatabaseUrl });
  await client.connect();
});

afterAll(async () => {
  await client.end();
  await dropEmptyDatabase();
});

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
  it('applies on an empty database and creates the five tables', async () => {
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
          /INDEX \S+ ON public\.email_outbox USING btree \(sent_at\) WHERE \(sent_at IS NULL\)/,
        ),
      ]),
    );
  });

  it('is reverted by the rollback scripts (newest first), after which it can be applied again', async () => {
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
    expect(await appliedMigrations()).toBe(3);
  });

  it('is reverted by its rollback script (after the newer ones), leaving 0000 in place, and re-applies', async () => {
    await client.query('delete from email_outbox');
    // Newest first: drizzle only applies migrations newer than the last one recorded.
    await client.query(await rollback('0002_credentials_version'));
    await client.query(await rollback('0001_outbox_hardening'));

    expect(await indexDefinition('auth_attempts_window_start_idx')).toBeUndefined();
    expect(
      await sqlState(
        "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'discard', 'pt', '{}')",
      ),
    ).toBeUndefined();
    expect(await publicTables()).toEqual(IDENTITY_TABLES);
    expect(await appliedMigrations()).toBe(1);

    await client.query('delete from email_outbox');
    await runMigrations(emptyDatabaseUrl);
    expect(await indexDefinition('auth_attempts_window_start_idx')).toBeDefined();
    expect(await appliedMigrations()).toBe(3);
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

  it('is reverted by its rollback script alone, keeping the data of the older columns, and re-applies', async () => {
    await client.query(await rollback('0002_credentials_version'));

    expect(await credentialsColumns()).toEqual([]);
    expect(await publicTables()).toEqual(IDENTITY_TABLES);
    expect(await appliedMigrations()).toBe(2);
    const kept = await client.query("select 1 from users where email = 'cv@example.com'");
    expect(kept.rowCount).toBe(1);

    await runMigrations(emptyDatabaseUrl);
    expect(await credentialsColumns()).toHaveLength(3);
    expect(await appliedMigrations()).toBe(3);
  });
});
