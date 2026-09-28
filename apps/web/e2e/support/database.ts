import { createRequire } from 'node:module';

/**
 * Direct access to the e2e database: to reset the rate-limit counters between tests (every test
 * registers from the same IP, and the API allows 5 registrations per IP per hour) and to inspect
 * session state that no API answer exposes.
 */
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://argent:argent@localhost:5434/argent_e2e';

interface PgClient {
  connect(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

interface PgModule {
  Client: new (options: { connectionString: string }) => PgClient;
}

// `pg` is a dependency of the API, which owns the database; it is loaded from there instead of
// adding a second copy to the web app.
const requireFromApi = createRequire(new URL('../../../api/package.json', import.meta.url));
const pg = requireFromApi('pg') as PgModule;

async function withE2eDatabase<T>(work: (client: PgClient) => Promise<T>): Promise<T> {
  const name = new URL(E2E_DATABASE_URL).pathname.replace(/^\//, '');
  if (!name.endsWith('_e2e')) throw new Error(`Refusing to use "${name}": not an e2e database`);
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export async function resetAttemptLimits(): Promise<void> {
  await withE2eDatabase((client) => client.query('delete from auth_attempts'));
}

/**
 * Sessions of the user that are still usable. A detected refresh-token reuse revokes the whole
 * family, which leaves none.
 */
export async function liveSessionCount(email: string): Promise<number> {
  const { rows } = await withE2eDatabase((client) =>
    client.query(
      `select count(*)::int as live
         from sessions s join users u on u.id = s.user_id
        where u.email = $1 and s.revoked_at is null`,
      [email],
    ),
  );
  return Number(rows[0]?.live ?? 0);
}
