import { runMigrations } from '../src/shared/db/migrate';
import { ensureDatabase } from './helpers/test-database';

/**
 * Prepares the dedicated end-to-end database (created if missing, then migrated).
 * Run by Playwright's API webServer command before the API starts; the name must end in _e2e so
 * it is never a dev database.
 */
const url = process.env.E2E_DATABASE_URL;
if (!url) {
  console.error('E2E_DATABASE_URL is required');
  process.exit(1);
}
const name = new URL(url).pathname.replace(/^\//, '');
if (!name.endsWith('_e2e')) {
  console.error(`Refusing to prepare "${name}": the e2e database name must end in _e2e`);
  process.exit(1);
}

await ensureDatabase(url);
await runMigrations(url);
console.info(`E2E database "${name}" ready`);
