import cron from 'node-cron';
import type { Db } from '../db/client.js';
import { processPendingWebhookDeliveries } from '../domain/webhooks.js';

export type WebhookSchedulerHandle = {
  stop: () => void;
};

/** Default: every minute — picks due pending deliveries with backoff. */
export function startWebhookDeliveryScheduler(
  db: Db,
  cronExpression: string,
  log: { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void },
): WebhookSchedulerHandle {
  if (!cron.validate(cronExpression)) {
    throw new Error(`Invalid WEBHOOK_DELIVERY_CRON expression: ${cronExpression}`);
  }

  let running = false;
  const task = cron.schedule(cronExpression, async () => {
    if (running) {
      log.info({}, 'Skipping webhook delivery tick — previous run still in progress');
      return;
    }
    running = true;
    try {
      const result = await processPendingWebhookDeliveries(db, { limit: 50 });
      if (result.processed > 0) {
        log.info(result, 'Webhook delivery tick finished');
      }
    } catch (err) {
      log.error({ err }, 'Webhook delivery tick crashed');
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
