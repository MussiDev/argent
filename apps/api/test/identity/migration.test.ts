import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder, runMigrations } from '../../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl } from '../helpers/test-database';

const ALL_MIGRATIONS = 7;
const TABLES_BEFORE_0004 = [
  'auth_attempts',
  'email_outbox',
  'one_time_tokens',
  'sessions',
  'users',
];
const TABLES_AT_0004 = [
  'auth_attempts',
  'email_outbox',
  'oauth_states',
  'one_time_tokens',
  'sessions',
  'user_identities',
  'users',
];
const IDENTITY_TABLES = [
  'auth_attempts',
  'email_outbox',
  'oauth_states',
  'one_time_tokens',
  'recovery_codes',
  'sessions',
  'sign_in_challenges',
  'user_identities',
  'user_two_factor',
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
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0005_two_factor'));
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
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0005_two_factor'));
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
        and table_name in ('users', 'sessions')
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
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0005_two_factor'));
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

  it('is reverted by its rollback script (after the newer ones), restoring the previous index and keeping the rows, and re-applies', async () => {
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0005_two_factor'));
    await client.query(await rollback('0004_google_identity'));
    await client.query(await rollback('0003_outbox_retry'));

    expect(await nextAttemptColumn()).toEqual([]);
    expect(await outboxIndexes()).toEqual([PENDING_BY_SENT_AT]);
    expect(await publicTables()).toEqual(TABLES_BEFORE_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 4);
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
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0005_two_factor'));
    await client.query(await rollback('0004_google_identity'));
    expect(await publicTables()).toEqual(TABLES_BEFORE_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 3);

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

    await client.query(await rollback('0007_profile_display_name'));

    await client.query(await rollback('0005_two_factor'));
    expect(await sqlState(await rollback('0004_google_identity'))).toBe('23502');

    expect(await publicTables()).toEqual(TABLES_AT_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 2);
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
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 3);
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

const TWO_FACTOR_ATTEMPT_KINDS = [
  'second_factor_user_15m',
  'second_factor_user_24h',
  'two_factor_disable_user',
  'two_factor_disable_user_24h',
];
const TWO_FACTOR_OUTBOX_KINDS = ['two_factor_enabled', 'two_factor_disabled'];

async function insertUser(email: string): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `insert into users (email, password_hash, time_zone, language) values ('${email}', 'h', 'UTC', 'es') returning id`,
  );
  return inserted.rows[0]?.id ?? '';
}

function insertAttempt(kind: string): Promise<string | undefined> {
  return sqlState(
    `insert into auth_attempts (key, kind, window_start) values ('k-${kind}', '${kind}', now())`,
  );
}

function insertOutbox(kind: string): Promise<string | undefined> {
  return sqlState(
    `insert into email_outbox (id, kind, to_email, language, payload) values (gen_random_uuid(), '${kind}', 'a@example.com', 'es', '{"userId": null}')`,
  );
}

describe('0005_two_factor migration', () => {
  it('applies on a database at 0004: user_two_factor, recovery_codes, sign_in_challenges and the new kinds', async () => {
    await client.query(await rollback('0007_profile_display_name'));
    await client.query(await rollback('0005_two_factor'));
    expect(await publicTables()).toEqual(TABLES_AT_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 2);
    for (const kind of TWO_FACTOR_ATTEMPT_KINDS) expect(await insertAttempt(kind)).toBe('23514');
    for (const kind of TWO_FACTOR_OUTBOX_KINDS) expect(await insertOutbox(kind)).toBe('23514');

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(IDENTITY_TABLES);
    for (const kind of TWO_FACTOR_ATTEMPT_KINDS) expect(await insertAttempt(kind)).toBeUndefined();
    for (const kind of TWO_FACTOR_OUTBOX_KINDS) expect(await insertOutbox(kind)).toBeUndefined();
    expect(await insertAttempt('two_factor_other')).toBe('23514');
    expect(await insertOutbox('two_factor_other')).toBe('23514');

    const ana = await insertUser('ana@2fa.test');
    const bob = await insertUser('bob@2fa.test');
    // user_two_factor: one row per user, pending by default, step 0
    const settings = await client.query<{ enabled_at: Date | null; last_used_step: string }>(
      `insert into user_two_factor (user_id, secret_sealed) values ('${ana}', 's') returning enabled_at, last_used_step`,
    );
    expect(settings.rows).toEqual([{ enabled_at: null, last_used_step: '0' }]);
    expect(
      await sqlState(
        `insert into user_two_factor (user_id, secret_sealed) values ('${ana}', 's2')`,
      ),
    ).toBe('23505');
    expect(
      await sqlState(
        "insert into user_two_factor (user_id, secret_sealed) values (gen_random_uuid(), 's')",
      ),
    ).toBe('23503');
    // recovery_codes: generated id, unused by default
    const code = await client.query<{ id: string; used_at: Date | null }>(
      `insert into recovery_codes (user_id, code_hash) values ('${ana}', 'h') returning id, used_at`,
    );
    expect(code.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(code.rows[0]?.used_at).toBeNull();
    // sign_in_challenges: via and language checks, attempts default 0
    const challenge = (hash: string, via: string, language: string) =>
      sqlState(
        `insert into sign_in_challenges (token_hash, user_id, credentials_version, via, language, expires_at) values ('${hash}', '${ana}', 0, '${via}', '${language}', now())`,
      );
    expect(await challenge('c1', 'password', 'es')).toBeUndefined();
    expect(await challenge('c2', 'google', 'en')).toBeUndefined();
    expect(await challenge('c3', 'sms', 'es')).toBe('23514');
    expect(await challenge('c4', 'password', 'pt')).toBe('23514');
    expect(await challenge('c1', 'password', 'es')).toBe('23505');
    expect(await countOf('select sum(attempts) as n from sign_in_challenges')).toBe(0);

    // every new table cascades on user deletion
    await client.query(
      `insert into user_two_factor (user_id, secret_sealed) values ('${bob}', 's')`,
    );
    await client.query(`delete from users where id = '${ana}'`);
    expect(
      await countOf(
        'select (select count(*) from user_two_factor) + (select count(*) from recovery_codes) + (select count(*) from sign_in_challenges) as n',
      ),
    ).toBe(1);

    expect(await indexDefinition('recovery_codes_user_id_idx')).toBe(
      'CREATE INDEX recovery_codes_user_id_idx ON public.recovery_codes USING btree (user_id)',
    );
    expect(await indexDefinition('sign_in_challenges_expires_at_idx')).toBe(
      'CREATE INDEX sign_in_challenges_expires_at_idx ON public.sign_in_challenges USING btree (expires_at)',
    );
    expect(await indexDefinition('sign_in_challenges_user_id_idx')).toBe(
      'CREATE INDEX sign_in_challenges_user_id_idx ON public.sign_in_challenges USING btree (user_id)',
    );
  });

  it('is reverted by its rollback (restoring 0004 and deleting rows of the new kinds), and re-applies', async () => {
    const otherAttempts = "select count(*) as n from auth_attempts where kind = 'sign_in_ip'";
    const otherOutbox = "select count(*) as n from email_outbox where kind = 'discard'";
    await client.query(
      "insert into auth_attempts (key, kind, window_start) values ('ip-2fa', 'sign_in_ip', now())",
    );
    await client.query(
      "insert into email_outbox (id, kind, language, payload) values (gen_random_uuid(), 'discard', 'es', '{\"userId\": null}')",
    );
    const before = { attempts: await countOf(otherAttempts), outbox: await countOf(otherOutbox) };

    await client.query(await rollback('0007_profile_display_name'));

    await client.query(await rollback('0005_two_factor'));

    expect(await publicTables()).toEqual(TABLES_AT_0004);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 2);
    const attemptKinds = TWO_FACTOR_ATTEMPT_KINDS.map((kind) => `'${kind}'`).join(', ');
    const outboxKinds = TWO_FACTOR_OUTBOX_KINDS.map((kind) => `'${kind}'`).join(', ');
    expect(
      await countOf(`select count(*) as n from auth_attempts where kind in (${attemptKinds})`),
    ).toBe(0);
    expect(
      await countOf(`select count(*) as n from email_outbox where kind in (${outboxKinds})`),
    ).toBe(0);
    expect(await countOf(otherAttempts)).toBe(before.attempts);
    expect(await countOf(otherOutbox)).toBe(before.outbox);
    for (const kind of TWO_FACTOR_ATTEMPT_KINDS) expect(await insertAttempt(kind)).toBe('23514');
    for (const kind of TWO_FACTOR_OUTBOX_KINDS) expect(await insertOutbox(kind)).toBe('23514');
    expect(await insertAttempt('google_start_ip')).toBeUndefined();
    expect(await countOf("select count(*) as n from users where email = 'bob@2fa.test'")).toBe(1);

    await runMigrations(emptyDatabaseUrl);
    expect(await publicTables()).toEqual(IDENTITY_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });
});

async function displayNameColumn(): Promise<ColumnInfo[]> {
  const result = await client.query<ColumnInfo>(
    `select table_name, column_name, data_type, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public' and table_name = 'users' and column_name = 'display_name'`,
  );
  return result.rows;
}

describe('0007_profile_display_name migration', () => {
  it('applies on a database at 0005 with existing users, who keep a null display name', async () => {
    await client.query(await rollback('0007_profile_display_name'));
    expect(await displayNameColumn()).toEqual([]);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 1);
    await insertUser('before@profile.test');

    await runMigrations(emptyDatabaseUrl);

    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
    expect(await publicTables()).toEqual(IDENTITY_TABLES);
    expect(await displayNameColumn()).toEqual([
      {
        table_name: 'users',
        column_name: 'display_name',
        data_type: 'text',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);
    expect(
      await countOf(
        "select count(*) as n from users where email = 'before@profile.test' and display_name is null",
      ),
    ).toBe(1);
    const named = (name: string) =>
      sqlState(`update users set display_name = '${name}' where email = 'before@profile.test'`);
    expect(await named('')).toBe('23514');
    expect(await named('x'.repeat(51))).toBe('23514');
    expect(await named('x'.repeat(50))).toBeUndefined();
  });

  it('is reverted by its rollback (dropping the column, keeping the users), and re-applies', async () => {
    await client.query(await rollback('0007_profile_display_name'));

    expect(await displayNameColumn()).toEqual([]);
    expect(await publicTables()).toEqual(IDENTITY_TABLES);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS - 1);
    expect(
      await countOf("select count(*) as n from users where email = 'before@profile.test'"),
    ).toBe(1);
    expect(
      await sqlState(
        "insert into users (email, password_hash, time_zone, language, display_name) values ('late@profile.test', 'h', 'UTC', 'es', 'x')",
      ),
    ).toBe('42703');

    await runMigrations(emptyDatabaseUrl);
    expect(await displayNameColumn()).toHaveLength(1);
    expect(await appliedMigrations()).toBe(ALL_MIGRATIONS);
  });
});
