import { loadConfig } from './lib/config.js';
import { getDb, closeDb } from './db/client.js';
import { buildApp } from './api/app.js';
import { startSyncScheduler } from './workers/scheduler.js';
import { startWebhookDeliveryScheduler } from './workers/webhook-delivery.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = getDb(config.DATABASE_URL);
  const app = await buildApp({ db, config });

  const scheduler = startSyncScheduler(db, config.SYNC_CRON, app.log);
  const webhookScheduler = startWebhookDeliveryScheduler(
    db,
    config.WEBHOOK_DELIVERY_CRON,
    app.log,
  );

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(
    {
      port: config.PORT,
      docs: `http://localhost:${config.PORT}/docs`,
      dryRun: config.fintableDryRun,
      syncCron: config.SYNC_CRON,
      webhookCron: config.WEBHOOK_DELIVERY_CRON,
    },
    'Spendo Banking Hub listening',
  );

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    scheduler.stop();
    webhookScheduler.stop();
    await app.close();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
