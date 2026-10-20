import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { balances, bankAccounts } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { toDecimalString } from '../lib/amounts.js';

export type AccountFilters = {
  tenantIds: string[];
  tenantId?: string;
  currency?: string;
  status?: string;
};

export async function listAccounts(db: Db, filters: AccountFilters) {
  const tenantIds = filters.tenantId
    ? filters.tenantIds.filter((id) => id === filters.tenantId)
    : filters.tenantIds;
  if (tenantIds.length === 0) return [];

  const conditions = [inArray(bankAccounts.tenantId, tenantIds)];
  if (filters.currency) conditions.push(eq(bankAccounts.currency, filters.currency));
  if (filters.status) conditions.push(eq(bankAccounts.status, filters.status));

  const rows = await db
    .select()
    .from(bankAccounts)
    .where(and(...conditions))
    .orderBy(asc(bankAccounts.name));

  return rows.map(serializeAccount);
}

export async function getAccount(db: Db, accountId: string, allowedTenantIds: string[]) {
  const row = await db.query.bankAccounts.findFirst({
    where: eq(bankAccounts.id, accountId),
  });
  if (!row || !allowedTenantIds.includes(row.tenantId)) {
    throw notFound('Account not found');
  }
  return serializeAccount(row);
}

export async function listAccountBalances(
  db: Db,
  accountId: string,
  allowedTenantIds: string[],
) {
  const account = await db.query.bankAccounts.findFirst({
    where: eq(bankAccounts.id, accountId),
  });
  if (!account || !allowedTenantIds.includes(account.tenantId)) {
    throw notFound('Account not found');
  }

  // Latest balance per type
  const rows = await db
    .select()
    .from(balances)
    .where(eq(balances.bankAccountId, accountId))
    .orderBy(desc(balances.retrievedAt));

  const latestByType = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByType.has(row.balanceType)) {
      latestByType.set(row.balanceType, row);
    }
  }

  return [...latestByType.values()].map((b) => ({
    id: b.id,
    tenant_id: b.tenantId,
    bank_account_id: b.bankAccountId,
    balance_type: b.balanceType,
    amount: toDecimalString(b.amount),
    currency: b.currency,
    as_of: b.asOf.toISOString(),
    retrieved_at: b.retrievedAt.toISOString(),
  }));
}

function serializeAccount(row: typeof bankAccounts.$inferSelect) {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    provider_connection_id: row.providerConnectionId,
    external_account_id: row.externalAccountId,
    name: row.name,
    iban: row.iban,
    currency: row.currency,
    account_type: row.accountType,
    status: row.status,
    last_provider_update_at: row.lastProviderUpdateAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
