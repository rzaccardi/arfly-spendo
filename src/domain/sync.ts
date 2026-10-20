import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  balances,
  bankAccounts,
  pendingTransactions,
  providerConnections,
  syncJobs,
  transactions,
} from '../db/schema.js';
import { decryptSecret } from '../lib/crypto.js';
import { getConfig } from '../lib/config.js';
import { withExponentialBackoff } from '../lib/retry.js';
import { FintableClient, withTokenLock } from '../providers/fintable/client.js';
import { createFintableProvider } from '../providers/fintable/adapter.js';
import type { BankingProvider } from '../providers/types.js';
import { FintableHttpError } from '../providers/fintable/client.js';
import { emitWebhookBestEffort } from './webhooks.js';

const DELETION_CATCH_DAYS = 30;

export type SyncResult = {
  connectionId: string;
  tenantId: string;
  jobId: string;
  status: 'succeeded' | 'failed' | 'skipped';
  recordsProcessed: number;
  errorMessage?: string;
};

function trailingWindowDate(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function upsertTransaction(
  db: Db,
  row: {
    tenantId: string;
    bankAccountId: string;
    externalTransactionId: string;
    bookingDate: string;
    valueDate: string | null;
    amount: string;
    currency: string;
    description: string | null;
    counterpartyName: string | null;
    counterpartyIban: string | null;
    status: string;
    rawData: Record<string, unknown> | null;
    providerUpdatedAt: Date | null;
  },
): Promise<{ outcome: 'inserted' | 'updated'; id: string }> {
  const existing = await db.query.transactions.findFirst({
    where: and(
      eq(transactions.bankAccountId, row.bankAccountId),
      eq(transactions.externalTransactionId, row.externalTransactionId),
    ),
  });

  if (existing) {
    await db
      .update(transactions)
      .set({
        bookingDate: row.bookingDate,
        valueDate: row.valueDate,
        amount: row.amount,
        currency: row.currency,
        description: row.description,
        counterpartyName: row.counterpartyName,
        counterpartyIban: row.counterpartyIban,
        status: row.status,
        rawData: row.rawData,
        providerUpdatedAt: row.providerUpdatedAt,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, existing.id));
    return { outcome: 'updated', id: existing.id };
  }

  const [inserted] = await db
    .insert(transactions)
    .values({
      tenantId: row.tenantId,
      bankAccountId: row.bankAccountId,
      externalTransactionId: row.externalTransactionId,
      bookingDate: row.bookingDate,
      valueDate: row.valueDate,
      amount: row.amount,
      currency: row.currency,
      description: row.description,
      counterpartyName: row.counterpartyName,
      counterpartyIban: row.counterpartyIban,
      status: row.status,
      rawData: row.rawData,
      providerUpdatedAt: row.providerUpdatedAt,
    })
    .returning();
  return { outcome: 'inserted', id: inserted!.id };
}

export function createProviderForConnection(
  workspaceId: string,
  decryptedToken: string,
): BankingProvider {
  const cfg = getConfig();
  const dryRun = cfg.fintableDryRun && !decryptedToken;
  const client = new FintableClient({
    baseUrl: cfg.FINTABLE_BASE_URL,
    token: decryptedToken || cfg.FINTABLE_API_TOKEN,
    workspaceId,
    dryRun,
  });
  return createFintableProvider(client);
}

async function markConnectionSkipped(
  db: Db,
  connectionId: string,
  jobId: string,
  message: string,
): Promise<void> {
  await db
    .update(syncJobs)
    .set({
      status: 'skipped',
      completedAt: new Date(),
      errorMessage: message,
      recordsProcessed: 0,
    })
    .where(eq(syncJobs.id, jobId));
  await db
    .update(providerConnections)
    .set({ lastError: message, updatedAt: new Date() })
    .where(eq(providerConnections.id, connectionId));
}

export async function syncProviderConnection(
  db: Db,
  connectionId: string,
  options: { requestProviderSync?: boolean } = {},
): Promise<SyncResult> {
  const connection = await db.query.providerConnections.findFirst({
    where: eq(providerConnections.id, connectionId),
  });
  if (!connection) {
    return {
      connectionId,
      tenantId: '',
      jobId: '',
      status: 'failed',
      recordsProcessed: 0,
      errorMessage: 'Connection not found',
    };
  }
  if (connection.status !== 'active') {
    return {
      connectionId,
      tenantId: connection.tenantId,
      jobId: '',
      status: 'skipped',
      recordsProcessed: 0,
      errorMessage: 'Connection not active',
    };
  }

  const [job] = await db
    .insert(syncJobs)
    .values({
      tenantId: connection.tenantId,
      providerConnectionId: connection.id,
      status: 'running',
      startedAt: new Date(),
    })
    .returning();

  const jobId = job!.id;
  let recordsProcessed = 0;

  await db
    .update(providerConnections)
    .set({ lastSyncAttemptAt: new Date(), updatedAt: new Date(), lastError: null })
    .where(eq(providerConnections.id, connection.id));

  try {
    const cfg = getConfig();
    let token: string;
    try {
      token = decryptSecret(connection.encryptedCredentials, cfg.ENCRYPTION_KEY);
    } catch (err) {
      const message = `Credential decrypt failed: ${err instanceof Error ? err.message : String(err)}`;
      await markConnectionSkipped(db, connection.id, jobId, message);
      return {
        connectionId: connection.id,
        tenantId: connection.tenantId,
        jobId,
        status: 'skipped',
        recordsProcessed: 0,
        errorMessage: message,
      };
    }

    if (!token.trim()) {
      const message = 'Encrypted credentials decrypt to an empty token — skipping sync';
      await markConnectionSkipped(db, connection.id, jobId, message);
      return {
        connectionId: connection.id,
        tenantId: connection.tenantId,
        jobId,
        status: 'skipped',
        recordsProcessed: 0,
        errorMessage: message,
      };
    }

    // When a live PAT is configured, skip connections whose stored token does not match
    // (e.g. vitest leftovers encrypted with "test-token" on the same DB).
    if (cfg.FINTABLE_API_TOKEN && token !== cfg.FINTABLE_API_TOKEN) {
      const message =
        'Stored token does not match FINTABLE_API_TOKEN — skipping (re-run seed/bootstrap to refresh credentials)';
      await markConnectionSkipped(db, connection.id, jobId, message);
      return {
        connectionId: connection.id,
        tenantId: connection.tenantId,
        jobId,
        status: 'skipped',
        recordsProcessed: 0,
        errorMessage: message,
      };
    }

    const tokenKey = token.slice(0, 16) || 'dry-run';

    const result = await withTokenLock(tokenKey, async () => {
      const provider = createProviderForConnection(connection.workspaceId, token);

      if (options.requestProviderSync && provider.requestProviderSync) {
        await withExponentialBackoff(
          async () => {
            const res = await provider.requestProviderSync!();
            if (!res.accepted) {
              throw new FintableHttpError(
                429,
                'Provider sync rate limited',
                res.retryAfterSeconds,
              );
            }
          },
          { maxAttempts: 2, baseDelayMs: 1000 },
        );
      }

      const accounts = await withExponentialBackoff(() =>
        provider.listAccounts(connection.id),
      );

      for (const account of accounts) {
        const [upserted] = await db
          .insert(bankAccounts)
          .values({
            tenantId: connection.tenantId,
            providerConnectionId: connection.id,
            externalAccountId: account.externalId,
            name: account.name,
            iban: account.iban,
            currency: account.currency,
            accountType: account.accountType,
            status: account.status === 'disabled' ? 'disabled' : 'active',
            lastProviderUpdateAt: account.lastProviderUpdateAt
              ? new Date(account.lastProviderUpdateAt)
              : null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [bankAccounts.providerConnectionId, bankAccounts.externalAccountId],
            set: {
              name: account.name,
              iban: account.iban,
              currency: account.currency,
              accountType: account.accountType,
              status: account.status === 'disabled' ? 'disabled' : 'active',
              lastProviderUpdateAt: account.lastProviderUpdateAt
                ? new Date(account.lastProviderUpdateAt)
                : null,
              updatedAt: new Date(),
            },
          })
          .returning();

        const bankAccountId = upserted!.id;
        recordsProcessed += 1;

        const bals = await withExponentialBackoff(() =>
          provider.getBalances(account.externalId),
        );
        // Replace latest balance snapshot types for this account
        for (const bal of bals) {
          await db.insert(balances).values({
            tenantId: connection.tenantId,
            bankAccountId,
            balanceType: bal.balanceType,
            amount: bal.amount,
            currency: bal.currency,
            asOf: new Date(bal.asOf),
            retrievedAt: new Date(),
          });
          recordsProcessed += 1;
          emitWebhookBestEffort(db, {
            tenantId: connection.tenantId,
            event: 'account.balance_updated',
            eventId: `bal.${bankAccountId}.${jobId}.${bal.balanceType}`,
            data: {
              account_id: bankAccountId,
              balance_type: bal.balanceType,
              amount: bal.amount,
              currency: bal.currency,
              as_of: bal.asOf,
              sync_job_id: jobId,
            },
          });
        }

        // Incremental transactions
        let cursor: string | null = null;
        const updatedSince = connection.syncCursorUpdatedSince?.toISOString() ?? null;
        let maxUpdatedAt: Date | null = connection.syncCursorUpdatedSince;

        do {
          const page = await withExponentialBackoff(() =>
            provider.getTransactions(account.externalId, {
              updatedSince,
              order: 'updated',
              cursor,
              limit: 200,
            }),
          );
          for (const tx of page.data) {
            const providerUpdatedAt = tx.providerUpdatedAt
              ? new Date(tx.providerUpdatedAt)
              : null;
            const upserted = await upsertTransaction(db, {
              tenantId: connection.tenantId,
              bankAccountId,
              externalTransactionId: tx.externalId,
              bookingDate: tx.bookingDate,
              valueDate: tx.valueDate,
              amount: tx.amount,
              currency: tx.currency,
              description: tx.description,
              counterpartyName: tx.counterpartyName,
              counterpartyIban: tx.counterpartyIban,
              status: tx.status,
              rawData: tx.raw,
              providerUpdatedAt,
            });
            recordsProcessed += 1;
            if (upserted.outcome === 'inserted') {
              emitWebhookBestEffort(db, {
                tenantId: connection.tenantId,
                event: 'transaction.created',
                eventId: `tx.created.${bankAccountId}.${tx.externalId}`,
                data: {
                  transaction_id: upserted.id,
                  account_id: bankAccountId,
                  external_transaction_id: tx.externalId,
                  amount: tx.amount,
                  currency: tx.currency,
                  booking_date: tx.bookingDate,
                },
              });
            } else {
              const stamp = providerUpdatedAt?.toISOString() ?? 'unknown';
              emitWebhookBestEffort(db, {
                tenantId: connection.tenantId,
                event: 'transaction.updated',
                eventId: `tx.updated.${bankAccountId}.${tx.externalId}.${stamp}`,
                data: {
                  transaction_id: upserted.id,
                  account_id: bankAccountId,
                  external_transaction_id: tx.externalId,
                  amount: tx.amount,
                  currency: tx.currency,
                  booking_date: tx.bookingDate,
                },
              });
            }
            if (providerUpdatedAt && (!maxUpdatedAt || providerUpdatedAt > maxUpdatedAt)) {
              maxUpdatedAt = providerUpdatedAt;
            }
          }
          cursor = page.nextCursor;
        } while (cursor);

        // Deletion catch: re-fetch trailing window (no deletion events from Fintable)
        const dateFrom = trailingWindowDate(DELETION_CATCH_DAYS);
        let catchCursor: string | null = null;
        const seenIds = new Set<string>();
        do {
          const page = await withExponentialBackoff(() =>
            provider.getTransactions(account.externalId, {
              dateFrom,
              order: 'date',
              cursor: catchCursor,
              limit: 200,
            }),
          );
          for (const tx of page.data) {
            seenIds.add(tx.externalId);
            const upserted = await upsertTransaction(db, {
              tenantId: connection.tenantId,
              bankAccountId,
              externalTransactionId: tx.externalId,
              bookingDate: tx.bookingDate,
              valueDate: tx.valueDate,
              amount: tx.amount,
              currency: tx.currency,
              description: tx.description,
              counterpartyName: tx.counterpartyName,
              counterpartyIban: tx.counterpartyIban,
              status: tx.status,
              rawData: tx.raw,
              providerUpdatedAt: tx.providerUpdatedAt ? new Date(tx.providerUpdatedAt) : null,
            });
            recordsProcessed += 1;
            // Deletion-catch path: only emit created (idempotent); skip updated noise
            if (upserted.outcome === 'inserted') {
              emitWebhookBestEffort(db, {
                tenantId: connection.tenantId,
                event: 'transaction.created',
                eventId: `tx.created.${bankAccountId}.${tx.externalId}`,
                data: {
                  transaction_id: upserted.id,
                  account_id: bankAccountId,
                  external_transaction_id: tx.externalId,
                  amount: tx.amount,
                  currency: tx.currency,
                  booking_date: tx.bookingDate,
                },
              });
            }
          }
          catchCursor = page.nextCursor;
        } while (catchCursor);

        // Mark local booked txs in trailing window missing from provider as potentially deleted
        // (soft status — Fintable does not emit deletion events)
        if (seenIds.size > 0) {
          const local = await db
            .select({
              id: transactions.id,
              externalTransactionId: transactions.externalTransactionId,
            })
            .from(transactions)
            .where(
              and(
                eq(transactions.bankAccountId, bankAccountId),
                gte(transactions.bookingDate, dateFrom),
              ),
            );
          for (const row of local) {
            if (!seenIds.has(row.externalTransactionId)) {
              await db
                .update(transactions)
                .set({ status: 'missing_from_provider', updatedAt: new Date() })
                .where(eq(transactions.id, row.id));
            }
          }
        }

        // Pending snapshot replace-all
        if (provider.capabilities.supportsPendingSnapshot && provider.getPendingTransactions) {
          const pending = await withExponentialBackoff(() =>
            provider.getPendingTransactions!(account.externalId),
          );
          await db
            .delete(pendingTransactions)
            .where(eq(pendingTransactions.bankAccountId, bankAccountId));
          for (const item of pending.items) {
            await db.insert(pendingTransactions).values({
              tenantId: connection.tenantId,
              bankAccountId,
              bookingDate: item.bookingDate,
              amount: item.amount,
              currency: item.currency,
              description: item.description,
              counterpartyName: item.counterpartyName,
              asOf: pending.asOf ? new Date(pending.asOf) : null,
              supported: pending.supported,
              snapshotPayload: item.raw ?? null,
            });
            recordsProcessed += 1;
          }
        }

        if (maxUpdatedAt) {
          await db
            .update(providerConnections)
            .set({ syncCursorUpdatedSince: maxUpdatedAt, updatedAt: new Date() })
            .where(eq(providerConnections.id, connection.id));
        }
      }

      return recordsProcessed;
    });

    recordsProcessed = result;

    await db
      .update(syncJobs)
      .set({
        status: 'succeeded',
        completedAt: new Date(),
        recordsProcessed,
      })
      .where(eq(syncJobs.id, jobId));

    const now = new Date();
    await db
      .update(providerConnections)
      .set({
        lastSyncAt: now,
        lastSuccessfulSyncAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(providerConnections.id, connection.id));

    emitWebhookBestEffort(db, {
      tenantId: connection.tenantId,
      event: 'sync.completed',
      eventId: `sync.ok.${jobId}`,
      data: {
        sync_job_id: jobId,
        provider_connection_id: connection.id,
        records_processed: recordsProcessed,
      },
    });

    return {
      connectionId: connection.id,
      tenantId: connection.tenantId,
      jobId,
      status: 'succeeded',
      recordsProcessed,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isAuthFailure =
      err instanceof FintableHttpError && (err.status === 401 || err.status === 403);

    await db
      .update(syncJobs)
      .set({
        status: 'failed',
        completedAt: new Date(),
        errorMessage: message,
        recordsProcessed,
      })
      .where(eq(syncJobs.id, jobId));
    await db
      .update(providerConnections)
      .set({
        lastError: message,
        updatedAt: new Date(),
        ...(isAuthFailure ? { status: 'expired' } : {}),
      })
      .where(eq(providerConnections.id, connection.id));

    emitWebhookBestEffort(db, {
      tenantId: connection.tenantId,
      event: 'sync.failed',
      eventId: `sync.fail.${jobId}`,
      data: {
        sync_job_id: jobId,
        provider_connection_id: connection.id,
        error_message: message,
        records_processed: recordsProcessed,
      },
    });

    if (isAuthFailure) {
      const day = new Date().toISOString().slice(0, 10);
      emitWebhookBestEffort(db, {
        tenantId: connection.tenantId,
        event: 'connection.expired',
        eventId: `conn.exp.${connection.id}.${day}`,
        data: {
          provider_connection_id: connection.id,
          workspace_id: connection.workspaceId,
          error_message: message,
          http_status: err.status,
        },
      });
    }

    return {
      connectionId: connection.id,
      tenantId: connection.tenantId,
      jobId,
      status: 'failed',
      recordsProcessed,
      errorMessage: message,
    };
  }
}

export async function syncAllActiveConnections(db: Db): Promise<SyncResult[]> {
  const connections = await db
    .select()
    .from(providerConnections)
    .where(eq(providerConnections.status, 'active'));

  const results: SyncResult[] = [];
  for (const c of connections) {
    results.push(await syncProviderConnection(db, c.id));
  }
  return results;
}

export async function getSyncStatusForTenants(db: Db, tenantIds: string[]) {
  if (tenantIds.length === 0) {
    return { connections: [], recent_jobs: [] };
  }
  const connections = await db
    .select()
    .from(providerConnections)
    .where(
      and(
        eq(providerConnections.status, 'active'),
        inArray(providerConnections.tenantId, tenantIds),
      ),
    );

  const jobs = await db
    .select()
    .from(syncJobs)
    .where(inArray(syncJobs.tenantId, tenantIds))
    .orderBy(desc(syncJobs.createdAt))
    .limit(50);

  return {
    connections: connections.map((c) => ({
      id: c.id,
      tenant_id: c.tenantId,
      provider: c.provider,
      workspace_id: c.workspaceId,
      status: c.status,
      last_sync_at: c.lastSyncAt?.toISOString() ?? null,
      last_sync_attempt_at: c.lastSyncAttemptAt?.toISOString() ?? null,
      last_successful_sync_at: c.lastSuccessfulSyncAt?.toISOString() ?? null,
      last_error: c.lastError,
      data_freshness_at: c.lastSuccessfulSyncAt?.toISOString() ?? null,
    })),
    recent_jobs: jobs.map((j) => ({
      id: j.id,
      tenant_id: j.tenantId,
      provider_connection_id: j.providerConnectionId,
      status: j.status,
      started_at: j.startedAt?.toISOString() ?? null,
      completed_at: j.completedAt?.toISOString() ?? null,
      error_message: j.errorMessage,
      records_processed: j.recordsProcessed,
    })),
  };
}
