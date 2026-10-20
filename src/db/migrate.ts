import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const { db, sql } = createDb(url);
  try {
    // Use public so app DB users on managed Postgres (DO) do not need CREATE SCHEMA.
    // Default drizzle schema requires CREATE on the database (error 42501).
    await migrate(db, {
      migrationsFolder: path.join(__dirname, 'migrations'),
      migrationsSchema: 'public',
      migrationsTable: '__drizzle_migrations',
    });
    console.log('Migrations applied successfully.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[migrate] failed — API will not start until this succeeds:', err);
  process.exit(1);
});
