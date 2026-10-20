import cron from 'node-cron';
import type { Db } from '../db/client.js';
import { syncAllActiveConnections } from '../domain/sync.js';

export type SchedulerHandle = {
  stop: () => void;
};

export function startSyncScheduler(
  db: Db,
  cronExpression: string,
  log: { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void },
): SchedulerHandle {
  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid SYNC_CRON expression: ${cronExpression}`);
  }

  let running = false;
  const task = cron.schedule(cronExpression, async () => {
    if (running) {
      log.info({}, 'Skipping sync tick — previous run still in progress');
      return;
    }
    running = true;
    try {
      log.info({ cron: cronExpression }, 'Starting scheduled sync');
      const results = await syncAllActiveConnections(db);
      log.info(
        {
          succeeded: results.filter((r) => r.status === 'succeeded').length,
          failed: results.filter((r) => r.status === 'failed').length,
          skipped: results.filter((r) => r.status === 'skipped').length,
        },
        'Scheduled sync finished',
      );
    } catch (err) {
      log.error({ err }, 'Scheduled sync crashed');
    } finally {
      running = false;
    }
  });

  return {
    stop: () => {
      task.stop();
    },
  };
}
