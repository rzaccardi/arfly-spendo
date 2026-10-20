import { loadConfig } from '../lib/config.js';
import { getDb, closeDb } from '../db/client.js';
import { syncAllActiveConnections } from '../domain/sync.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = getDb(config.DATABASE_URL);
  console.log('Running one-shot sync for all active connections...');
  const results = await syncAllActiveConnections(db);
  console.log(JSON.stringify(results, null, 2));
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
