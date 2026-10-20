import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pendingTransactions, transactions } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { toDecimalString } from '../lib/amounts.js';
import {
  clampLimit,
  decodeCursor,
  paginationResponse,
} from '../lib/pagination.js';

export type TransactionFilters = {
  tenantIds: string[];
  tenantId?: string;
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: 'credit' | 'debit';
  status?: string;
  minAmount?: string;
  maxAmount?: string;
  /** Free-text search on description / counterparty */
  q?: string;
  cursor?: string;
  limit?: number;
  includePending?: boolean;
};

export async function listTransactions(db: Db, filters: TransactionFilters) {
  const tenantIds = filters.tenantId
    ? filters.tenantIds.filter((id) => id === filters.tenantId)
    : filters.tenantIds;
  if (tenantIds.length === 0) {
    return { data: [], pagination: { next_cursor: null, has_more: false } };
  }

  const limit = clampLimit(filters.limit, 50, 5000);
  const conditions = [inArray(transactions.tenantId, tenantIds)];

  if (filters.accountId) conditions.push(eq(transactions.bankAccountId, filters.accountId));
  if (filters.dateFrom) conditions.push(gte(transactions.bookingDate, filters.dateFrom));
  if (filters.dateTo) conditions.push(lte(transactions.bookingDate, filters.dateTo));
  if (filters.status) conditions.push(eq(transactions.status, filters.status));
  if (filters.type === 'credit') {
    conditions.push(sql`${transactions.amount}::numeric > 0`);
  } else if (filters.type === 'debit') {
    conditions.push(sql`${transactions.amount}::numeric < 0`);
  }
  if (filters.minAmount) {
    conditions.push(sql`${transactions.amount}::numeric >= ${filters.minAmount}::numeric`);
  }
  if (filters.maxAmount) {
    conditions.push(sql`${transactions.amount}::numeric <= ${filters.maxAmount}::numeric`);
  }
  if (filters.q?.trim()) {
    const pattern = `%${filters.q.trim()}%`;
    conditions.push(
      or(
        ilike(transactions.description, pattern),
        ilike(transactions.counterpartyName, pattern),
        ilike(transactions.counterpartyIban, pattern),
      )!,
    );
  }

  if (filters.cursor) {
    let cursor;
    try {
      cursor = decodeCursor(filters.cursor);
    } catch {
      throw badRequest('Invalid cursor');
    }
    conditions.push(
      sql`(${transactions.createdAt}, ${transactions.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.createdAt), desc(transactions.id))
    .limit(limit + 1);

  const page = paginationResponse(rows, limit);
  return {
    data: page.data.map(serializeTransaction),
    pagination: page.pagination,
  };
}

export async function getTransaction(db: Db, txId: string, allowedTenantIds: string[]) {
  const row = await db.query.transactions.findFirst({
    where: eq(transactions.id, txId),
  });
  if (!row || !allowedTenantIds.includes(row.tenantId)) {
    throw notFound('Transaction not found');
  }
  return serializeTransaction(row);
}

export async function listPendingForAccounts(db: Db, accountIds: string[], tenantIds: string[]) {
  if (accountIds.length === 0 || tenantIds.length === 0) return [];
  const rows = await db
    .select()
    .from(pendingTransactions)
    .where(
      and(
        inArray(pendingTransactions.bankAccountId, accountIds),
        inArray(pendingTransactions.tenantId, tenantIds),
      ),
    )
    .orderBy(asc(pendingTransactions.bookingDate));

  return rows
    .filter((r) => {
      const payload = r.snapshotPayload as { placeholder?: boolean } | null;
      return !payload?.placeholder;
    })
    .map((r) => ({
      id: r.id,
      tenant_id: r.tenantId,
      bank_account_id: r.bankAccountId,
      booking_date: r.bookingDate,
      amount: toDecimalString(r.amount),
      currency: r.currency,
      description: r.description,
      counterparty_name: r.counterpartyName,
      status: 'pending',
      as_of: r.asOf?.toISOString() ?? null,
    }));
}

function serializeTransaction(row: typeof transactions.$inferSelect) {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    bank_account_id: row.bankAccountId,
    external_transaction_id: row.externalTransactionId,
    booking_date: row.bookingDate,
    value_date: row.valueDate,
    amount: toDecimalString(row.amount),
    currency: row.currency,
    description: row.description,
    counterparty_name: row.counterpartyName,
    counterparty_iban: row.counterpartyIban,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
