import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

let sqlClient: ReturnType<typeof postgres> | null = null;
let dbInstance: Db | null = null;

export function getDb(databaseUrl?: string): Db {
  if (dbInstance) return dbInstance;
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  sqlClient = postgres(url, { max: 10 });
  dbInstance = drizzle(sqlClient, { schema });
  return dbInstance;
}

export function createDb(databaseUrl: string): { db: Db; sql: ReturnType<typeof postgres> } {
  const sql = postgres(databaseUrl, { max: 5 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export async function closeDb(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = null;
    dbInstance = null;
  }
}

/** Test helper */
export function setDb(db: Db): void {
  dbInstance = db;
}
