import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client';

export const migrationsFolder = fileURLToPath(new URL('../../../drizzle', import.meta.url));

/** Applies pending SQL migrations from `apps/api/drizzle`; drizzle records them in `__drizzle_migrations`. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, pool } = createDatabase(databaseUrl);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to run migrations');
    process.exit(1);
  }
  await runMigrations(databaseUrl);
  console.info('Migrations applied');
}
