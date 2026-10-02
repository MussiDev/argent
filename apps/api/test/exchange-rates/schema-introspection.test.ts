import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseConnection } from '../../src/shared/db/client';
import { testDatabaseUrl } from '../helpers/test-database';

let connection: DatabaseConnection;

beforeAll(() => {
  connection = createDatabase(testDatabaseUrl);
});

afterAll(async () => {
  await connection.pool.end();
});

const TABLES = ['exchange_rate_refresh_failures', 'exchange_rate_sync', 'exchange_rates'];

describe('exchange-rates schema introspection', () => {
  it('has the three tables', async () => {
    const result = await connection.pool.query<{ tablename: string }>(
      'select tablename from pg_tables where schemaname = $1 and tablename = any($2) order by tablename',
      ['public', TABLES],
    );
    expect(result.rows.map((row) => row.tablename)).toEqual(TABLES);
  });

  it('has no float, real, double or numeric column', async () => {
    const result = await connection.pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name = any($1)
          and data_type in ('real', 'double precision', 'numeric', 'money')`,
      [TABLES],
    );
    expect(result.rows).toEqual([]);
  });

  it('has no foreign key at all, so none to users', async () => {
    const result = await connection.pool.query<{ conname: string }>(
      `select c.conname from pg_constraint c join pg_class t on t.oid = c.conrelid
        where c.contype = 'f' and t.relname = any($1)`,
      [TABLES],
    );
    expect(result.rows).toEqual([]);
  });
});
