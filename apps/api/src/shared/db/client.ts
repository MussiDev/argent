import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type Database = NodePgDatabase;

export interface DatabaseConnection {
  db: Database;
  pool: pg.Pool;
}

export function createDatabase(databaseUrl: string): DatabaseConnection {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return { db: drizzle({ client: pool }), pool };
}
