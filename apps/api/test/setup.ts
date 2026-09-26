import pg from 'pg';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../src/shared/db/migrate';
import { ensureTestDatabase, testDatabaseUrl, truncateAllTables } from './helpers/test-database';

let pool: pg.Pool | undefined;

beforeAll(async () => {
  await ensureTestDatabase(testDatabaseUrl);
  await runMigrations(testDatabaseUrl);
  pool = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
});

beforeEach(async () => {
  if (pool) await truncateAllTables(pool);
});

afterAll(async () => {
  await pool?.end();
});
