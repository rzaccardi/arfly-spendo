import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

let sqlClient: ReturnType<typeof postgres> | null = null;
let dbInstance: Db | null = null;

/** Ensure sslmode=require for remote hosts (DigitalOcean Managed DB). */
export function normalizeDatabaseUrl(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    const host = u.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!isLocal && !u.searchParams.has('sslmode')) {
      u.searchParams.set('sslmode', 'require');
    }
    return u.toString();
  } catch {
    return databaseUrl;
  }
}

function isLocalHost(databaseUrl: string): boolean {
  try {
    const host = new URL(databaseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/**
 * TLS options for postgres.js. `sslmode=require` encrypts but does NOT verify the server
 * certificate (rejectUnauthorized=false). When DATABASE_CA_CERT holds the managed cluster CA
 * (DO: `${spendo-db.CA_CERT}`), the certificate chain is verified against it, so only a server
 * holding a certificate issued by that CA is accepted. Hostname is not checked because DO's
 * private-network hostnames are not always in the certificate; the project-specific CA is the
 * trust anchor.
 */
export function buildSslOptions(
  databaseUrl: string,
  caCert: string = process.env.DATABASE_CA_CERT ?? '',
): { ca: string; rejectUnauthorized: true; checkServerIdentity: () => undefined } | undefined {
  const ca = caCert.trim().replace(/\\n/g, '\n');
  if (!ca || isLocalHost(databaseUrl)) return undefined;
  return { ca, rejectUnauthorized: true, checkServerIdentity: () => undefined };
}

let warnedUnverifiedTls = false;
function postgresOptions(databaseUrl: string, max: number) {
  const ssl = buildSslOptions(databaseUrl);
  if (!ssl && !isLocalHost(databaseUrl) && !warnedUnverifiedTls) {
    warnedUnverifiedTls = true;
    console.warn(
      '[db] DATABASE_CA_CERT not set: TLS to Postgres is encrypted but the server certificate is NOT verified',
    );
  }
  return ssl ? { max, ssl } : { max };
}

export function getDb(databaseUrl?: string): Db {
  if (dbInstance) return dbInstance;
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  sqlClient = postgres(normalizeDatabaseUrl(url), postgresOptions(url, 10));
  dbInstance = drizzle(sqlClient, { schema });
  return dbInstance;
}

export function createDb(databaseUrl: string): { db: Db; sql: ReturnType<typeof postgres> } {
  const sql = postgres(normalizeDatabaseUrl(databaseUrl), postgresOptions(databaseUrl, 5));
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
