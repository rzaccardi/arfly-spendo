import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tenants, webhookDeliveries, webhookSubscriptions } from '../db/schema.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { getConfig } from '../lib/config.js';
import { badRequest, notFound } from '../lib/errors.js';
import { writeAuditLog } from '../lib/audit.js';

export const WEBHOOK_EVENTS = [
  'transaction.created',
  'transaction.updated',
  'account.balance_updated',
  'sync.completed',
  'sync.failed',
  'connection.expired',
  'connection.updated',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_MAX_ATTEMPTS = 8;
const WEBHOOK_TIMEOUT_MS = 10_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;

function serializeSubscription(
  row: typeof webhookSubscriptions.$inferSelect,
  opts?: { includeSecretOnce?: string },
) {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    url: row.url,
    events: row.events ?? [],
    status: row.status,
    description: row.description,
    last_delivery_at: row.lastDeliveryAt?.toISOString() ?? null,
    last_delivery_status: row.lastDeliveryStatus,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    ...(opts?.includeSecretOnce ? { signing_secret: opts.includeSecretOnce } : {}),
  };
}

export function signWebhookPayload(secret: string, body: string, timestamp: string): string {
  const base = `${timestamp}.${body}`;
  return createHmac('sha256', secret).update(base).digest('hex');
}

/** Constant-time hex HMAC compare for receivers / tests */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  timestamp: string,
  signature: string,
): boolean {
  const expected = signWebhookPayload(secret, body, timestamp);
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Exponential backoff after failed attempt `attemptCount` (1-based after first failure). */
export function webhookBackoffMs(attemptCount: number): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attemptCount - 1));
  return exp;
}

export async function listWebhookSubscriptions(db: Db, tenantId?: string) {
  const rows = tenantId
    ? await db
        .select()
        .from(webhookSubscriptions)
        .where(eq(webhookSubscriptions.tenantId, tenantId))
        .orderBy(asc(webhookSubscriptions.createdAt))
    : await db.select().from(webhookSubscriptions).orderBy(asc(webhookSubscriptions.createdAt));
  return rows.map((r) => serializeSubscription(r));
}

export async function createWebhookSubscription(
  db: Db,
  input: {
    tenant_id: string;
    url: string;
    events: string[];
    description?: string | null;
    secret?: string;
  },
) {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, input.tenant_id) });
  if (!tenant) throw notFound('Tenant not found');
  try {
    // eslint-disable-next-line no-new
    new URL(input.url);
  } catch {
    throw badRequest('Invalid webhook URL');
  }
  const events = input.events.filter((e) =>
    (WEBHOOK_EVENTS as readonly string[]).includes(e),
  );
  if (events.length === 0) {
    throw badRequest(`events must include one of: ${WEBHOOK_EVENTS.join(', ')}`);
  }

  const rawSecret = input.secret?.trim() || `whsec_${randomBytes(24).toString('base64url')}`;
  const config = getConfig();
  const encryptedSecret = encryptSecret(rawSecret, config.ENCRYPTION_KEY);

  const [row] = await db
    .insert(webhookSubscriptions)
    .values({
      tenantId: input.tenant_id,
      url: input.url,
      encryptedSecret,
      events,
      description: input.description ?? null,
      status: 'active',
    })
    .returning();

  await writeAuditLog(db, {
    tenantId: input.tenant_id,
    action: 'admin.webhook.create',
    resource: 'webhook_subscription',
    resourceId: row!.id,
  });

  return serializeSubscription(row!, { includeSecretOnce: rawSecret });
}

export async function deleteWebhookSubscription(db: Db, id: string) {
  const existing = await db.query.webhookSubscriptions.findFirst({
    where: eq(webhookSubscriptions.id, id),
  });
  if (!existing) throw notFound('Webhook subscription not found');
  await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
  await writeAuditLog(db, {
    tenantId: existing.tenantId,
    action: 'admin.webhook.delete',
    resource: 'webhook_subscription',
    resourceId: id,
  });
  return { id, deleted: true };
}

function buildEnvelope(eventId: string, event: string, data: Record<string, unknown>) {
  return {
    id: eventId,
    event,
    created_at: new Date().toISOString(),
    data,
  };
}

/**
 * Enqueue outbound deliveries for all active subscriptions of the tenant that listen to `event`.
 * Idempotent on `(subscription_id, event_id)` — duplicate enqueue is a no-op.
 * Best-effort: never throws for delivery enqueue failures (caller may still catch).
 */
export async function enqueueWebhookEvent(
  db: Db,
  input: {
    tenantId: string;
    event: string;
    data: Record<string, unknown>;
    /** Stable idempotency key; generated if omitted */
    eventId?: string;
  },
): Promise<{ enqueued: number }> {
  if (!(WEBHOOK_EVENTS as readonly string[]).includes(input.event)) {
    return { enqueued: 0 };
  }

  const subs = await db
    .select()
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.tenantId, input.tenantId),
        eq(webhookSubscriptions.status, 'active'),
      ),
    );

  const matching = subs.filter((s) => (s.events ?? []).includes(input.event));
  if (matching.length === 0) return { enqueued: 0 };

  const eventId = input.eventId?.trim() || `evt_${randomBytes(12).toString('hex')}`;
  const envelope = buildEnvelope(eventId, input.event, input.data);
  let enqueued = 0;

  for (const sub of matching) {
    try {
      await db.insert(webhookDeliveries).values({
        subscriptionId: sub.id,
        tenantId: sub.tenantId,
        eventId,
        event: input.event,
        payload: envelope,
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: new Date(),
      });
      enqueued += 1;
    } catch {
      // Unique violation → already queued (idempotent)
    }
  }

  return { enqueued };
}

/** Fire-and-forget wrapper used from sync paths */
export function emitWebhookBestEffort(
  db: Db,
  input: {
    tenantId: string;
    event: string;
    data: Record<string, unknown>;
    eventId?: string;
  },
): void {
  void enqueueWebhookEvent(db, input).catch(() => undefined);
}

async function deliverOnce(
  db: Db,
  delivery: typeof webhookDeliveries.$inferSelect,
  sub: typeof webhookSubscriptions.$inferSelect,
): Promise<{ status: 'succeeded' | 'failed'; httpStatus: number | null; errorMessage: string | null }> {
  const config = getConfig();
  const secret = decryptSecret(sub.encryptedSecret, config.ENCRYPTION_KEY);
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhookPayload(secret, body, timestamp);

  let httpStatus: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;
  let status: 'succeeded' | 'failed' = 'failed';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Spendo-Webhooks/0.1',
        'x-spendo-timestamp': timestamp,
        'x-spendo-signature': signature,
        'x-spendo-event': delivery.event,
        'x-spendo-delivery-id': delivery.id,
        'x-spendo-event-id': delivery.eventId,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    httpStatus = res.status;
    responseBody = (await res.text()).slice(0, 2000);
    status = res.ok ? 'succeeded' : 'failed';
    if (!res.ok) errorMessage = `HTTP ${res.status}`;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    status = 'failed';
  }

  const attemptCount = delivery.attemptCount + 1;
  const now = new Date();
  let storedStatus: 'succeeded' | 'pending' | 'dead' = status === 'succeeded' ? 'succeeded' : 'pending';
  let nextAttemptAt: Date | null = null;

  if (status === 'failed') {
    if (attemptCount >= WEBHOOK_MAX_ATTEMPTS) {
      storedStatus = 'dead';
    } else {
      storedStatus = 'pending';
      nextAttemptAt = new Date(now.getTime() + webhookBackoffMs(attemptCount));
    }
  }

  await db
    .update(webhookDeliveries)
    .set({
      status: storedStatus,
      attemptCount,
      nextAttemptAt,
      httpStatus,
      responseBody,
      errorMessage,
      attemptedAt: now,
    })
    .where(eq(webhookDeliveries.id, delivery.id));

  await db
    .update(webhookSubscriptions)
    .set({
      lastDeliveryAt: now,
      lastDeliveryStatus: storedStatus === 'pending' ? 'failed' : storedStatus,
      updatedAt: now,
    })
    .where(eq(webhookSubscriptions.id, sub.id));

  return { status, httpStatus, errorMessage };
}

/**
 * Process due outbound deliveries (pending with next_attempt_at <= now).
 * Tenant isolation is enforced by subscription → delivery tenant_id match at insert time.
 */
export async function processPendingWebhookDeliveries(
  db: Db,
  opts: { limit?: number; now?: Date } = {},
): Promise<{ processed: number; succeeded: number; failed: number; dead: number }> {
  const limit = opts.limit ?? 25;
  const now = opts.now ?? new Date();

  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(
      and(
        inArray(webhookDeliveries.status, ['pending']),
        or(lte(webhookDeliveries.nextAttemptAt, now), sql`${webhookDeliveries.nextAttemptAt} IS NULL`),
      ),
    )
    .orderBy(asc(webhookDeliveries.createdAt))
    .limit(limit);

  let succeeded = 0;
  let failed = 0;
  let dead = 0;

  for (const delivery of due) {
    const sub = await db.query.webhookSubscriptions.findFirst({
      where: eq(webhookSubscriptions.id, delivery.subscriptionId),
    });
    if (!sub || sub.status !== 'active' || sub.tenantId !== delivery.tenantId) {
      await db
        .update(webhookDeliveries)
        .set({
          status: 'dead',
          errorMessage: 'Subscription inactive or tenant mismatch',
          attemptedAt: now,
        })
        .where(eq(webhookDeliveries.id, delivery.id));
      dead += 1;
      continue;
    }

    const result = await deliverOnce(db, delivery, sub);
    if (result.status === 'succeeded') succeeded += 1;
    else {
      const refreshed = await db.query.webhookDeliveries.findFirst({
        where: eq(webhookDeliveries.id, delivery.id),
      });
      if (refreshed?.status === 'dead') dead += 1;
      else failed += 1;
    }
  }

  return { processed: due.length, succeeded, failed, dead };
}

/**
 * Immediate signed outbound attempt (admin test). Creates a pending row then delivers once.
 */
export async function attemptWebhookDelivery(
  db: Db,
  subscriptionId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<{
  delivery_id: string;
  status: string;
  http_status: number | null;
  error_message: string | null;
}> {
  const sub = await db.query.webhookSubscriptions.findFirst({
    where: eq(webhookSubscriptions.id, subscriptionId),
  });
  if (!sub) throw notFound('Webhook subscription not found');
  if (sub.status !== 'active') throw badRequest('Subscription is not active');

  const eventId = `test_${randomBytes(10).toString('hex')}`;
  const envelope = buildEnvelope(eventId, event, payload);

  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      subscriptionId: sub.id,
      tenantId: sub.tenantId,
      eventId,
      event,
      payload: envelope,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: new Date(),
    })
    .returning();

  const result = await deliverOnce(db, delivery!, sub);
  const refreshed = await db.query.webhookDeliveries.findFirst({
    where: eq(webhookDeliveries.id, delivery!.id),
  });

  return {
    delivery_id: delivery!.id,
    status: refreshed?.status ?? result.status,
    http_status: result.httpStatus,
    error_message: result.errorMessage,
  };
}

export async function listWebhookDeliveries(db: Db, subscriptionId: string, limit = 20) {
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.subscriptionId, subscriptionId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    event_id: r.eventId,
    event: r.event,
    status: r.status,
    attempt_count: r.attemptCount,
    next_attempt_at: r.nextAttemptAt?.toISOString() ?? null,
    http_status: r.httpStatus,
    error_message: r.errorMessage,
    attempted_at: r.attemptedAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
  }));
}
