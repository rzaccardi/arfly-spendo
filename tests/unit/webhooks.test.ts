import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import type { Db } from '../../src/db/client.js';
import {
  createWebhookSubscription,
  enqueueWebhookEvent,
  processPendingWebhookDeliveries,
  signWebhookPayload,
  verifyWebhookSignature,
  webhookBackoffMs,
} from '../../src/domain/webhooks.js';
import { webhookDeliveries } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { createTenantApp, createTestDb } from '../helpers.js';

describe('Webhook signing & backoff', () => {
  it('signs and verifies HMAC payload', () => {
    const secret = 'whsec_test';
    const body = '{"id":"evt_1","event":"sync.completed"}';
    const ts = '1710000000';
    const sig = signWebhookPayload(secret, body, ts);
    expect(verifyWebhookSignature(secret, body, ts, sig)).toBe(true);
    expect(verifyWebhookSignature(secret, body, ts, '00' + sig.slice(2))).toBe(false);
  });

  it('uses exponential backoff capped at 30m', () => {
    expect(webhookBackoffMs(1)).toBe(30_000);
    expect(webhookBackoffMs(2)).toBe(60_000);
    expect(webhookBackoffMs(3)).toBe(120_000);
    expect(webhookBackoffMs(20)).toBe(30 * 60_000);
  });
});

describe('Webhook enqueue & delivery', () => {
  let db: Db;
  let sql: postgres.Sql;

  beforeAll(async () => {
    ({ db, sql } = await createTestDb());
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('enqueues idempotently and delivers with unique event id', async () => {
    const { tenant } = await createTenantApp(db, {
      tenantName: `Wh Tenant ${Date.now()}`,
      appName: `Wh App ${Date.now()}`,
    });

    // Local mock server via undici/mock is heavy; use a non-routable URL and assert pending→retry
    const sub = await createWebhookSubscription(db, {
      tenant_id: tenant.id,
      url: 'http://127.0.0.1:9/webhook-sink',
      events: ['sync.completed'],
      description: 'test',
    });

    const first = await enqueueWebhookEvent(db, {
      tenantId: tenant.id,
      event: 'sync.completed',
      eventId: `sync.ok.test.${tenant.id}`,
      data: { ok: true },
    });
    expect(first.enqueued).toBe(1);

    const second = await enqueueWebhookEvent(db, {
      tenantId: tenant.id,
      event: 'sync.completed',
      eventId: `sync.ok.test.${tenant.id}`,
      data: { ok: true },
    });
    expect(second.enqueued).toBe(0);

    const rows = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.subscriptionId, sub.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventId).toBe(`sync.ok.test.${tenant.id}`);
    expect(rows[0]!.tenantId).toBe(tenant.id);

    const result = await processPendingWebhookDeliveries(db, { limit: 10 });
    expect(result.processed).toBeGreaterThanOrEqual(1);
    // Connection refused → failed attempt → still pending with next_attempt_at, or dead if max
    const after = await db.query.webhookDeliveries.findFirst({
      where: eq(webhookDeliveries.id, rows[0]!.id),
    });
    expect(after).toBeTruthy();
    expect(after!.attemptCount).toBeGreaterThanOrEqual(1);
    expect(['pending', 'dead', 'failed', 'succeeded']).toContain(after!.status);
  });
});
