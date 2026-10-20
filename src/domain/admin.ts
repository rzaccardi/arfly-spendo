import { and, asc, count, desc, eq, gte, ilike, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  applications,
  applicationCredentials,
  applicationTenantPermissions,
  auditLogs,
  bankAccounts,
  providerConnections,
  syncJobs,
  tenants,
  transactions,
} from '../db/schema.js';
import { generateApiKey, hashApiKey } from '../auth/api-keys.js';
import { ALL_PERMISSIONS, isPermission } from '../auth/permissions.js';
import { encryptSecret } from '../lib/crypto.js';
import { getConfig } from '../lib/config.js';
import { badRequest, notFound } from '../lib/errors.js';
import { writeAuditLog } from '../lib/audit.js';
import { clampLimit, decodeCursor, encodeCursor, paginationResponse } from '../lib/pagination.js';
import { listTransactions, type TransactionFilters } from './transactions.js';
import { syncProviderConnection } from './sync.js';

function serializeTenant(row: typeof tenants.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    legal_name: row.legalName,
    vat_number: row.vatNumber,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function adminOverview(db: Db) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [tenantCount] = await db.select({ value: count() }).from(tenants);
  const [accountCount] = await db.select({ value: count() }).from(bankAccounts);
  const [txCount] = await db.select({ value: count() }).from(transactions);
  const [connCount] = await db.select({ value: count() }).from(providerConnections);
  const [appCount] = await db.select({ value: count() }).from(applications);

  const [syncSucceeded] = await db
    .select({ value: count() })
    .from(syncJobs)
    .where(and(eq(syncJobs.status, 'succeeded'), gte(syncJobs.completedAt, since)));
  const [syncFailed] = await db
    .select({ value: count() })
    .from(syncJobs)
    .where(and(eq(syncJobs.status, 'failed'), gte(syncJobs.completedAt, since)));

  const [apiCalls] = await db
    .select({ value: count() })
    .from(auditLogs)
    .where(gte(auditLogs.timestamp, since));

  const recentJobs = await db
    .select()
    .from(syncJobs)
    .orderBy(desc(syncJobs.createdAt))
    .limit(8);

  return {
    tenants: tenantCount?.value ?? 0,
    accounts: accountCount?.value ?? 0,
    transactions: txCount?.value ?? 0,
    connections: connCount?.value ?? 0,
    applications: appCount?.value ?? 0,
    sync_succeeded_24h: syncSucceeded?.value ?? 0,
    sync_failed_24h: syncFailed?.value ?? 0,
    api_calls_24h: apiCalls?.value ?? 0,
    recent_jobs: recentJobs.map((j) => ({
      id: j.id,
      tenant_id: j.tenantId,
      status: j.status,
      records_processed: j.recordsProcessed,
      error_message: j.errorMessage,
      created_at: j.createdAt.toISOString(),
      completed_at: j.completedAt?.toISOString() ?? null,
    })),
  };
}

export async function adminListTenants(db: Db) {
  const rows = await db.select().from(tenants).orderBy(asc(tenants.name));
  const connections = await db.select().from(providerConnections);
  const byTenant = new Map<string, typeof connections>();
  for (const c of connections) {
    const list = byTenant.get(c.tenantId) ?? [];
    list.push(c);
    byTenant.set(c.tenantId, list);
  }
  const accountCounts = await db
    .select({ tenantId: bankAccounts.tenantId, value: count() })
    .from(bankAccounts)
    .groupBy(bankAccounts.tenantId);
  const accountMap = new Map(accountCounts.map((r) => [r.tenantId, r.value]));

  return rows.map((row) => {
    const conns = byTenant.get(row.id) ?? [];
    return {
      ...serializeTenant(row),
      account_count: accountMap.get(row.id) ?? 0,
      connections: conns.map((c) => ({
        id: c.id,
        provider: c.provider,
        workspace_id: c.workspaceId,
        status: c.status,
        last_sync_at: c.lastSyncAt?.toISOString() ?? null,
        last_error: c.lastError,
      })),
    };
  });
}

export async function adminCreateTenant(
  db: Db,
  input: { name: string; legal_name?: string | null; vat_number?: string | null; status?: string },
) {
  const [row] = await db
    .insert(tenants)
    .values({
      name: input.name,
      legalName: input.legal_name ?? null,
      vatNumber: input.vat_number ?? null,
      status: input.status ?? 'active',
    })
    .returning();
  await writeAuditLog(db, {
    tenantId: row!.id,
    action: 'admin.tenant.create',
    resource: 'tenant',
    resourceId: row!.id,
  });
  return serializeTenant(row!);
}

export async function adminUpdateTenant(
  db: Db,
  id: string,
  input: {
    name?: string;
    legal_name?: string | null;
    vat_number?: string | null;
    status?: string;
  },
) {
  const existing = await db.query.tenants.findFirst({ where: eq(tenants.id, id) });
  if (!existing) throw notFound('Tenant not found');
  const [row] = await db
    .update(tenants)
    .set({
      name: input.name ?? existing.name,
      legalName: input.legal_name !== undefined ? input.legal_name : existing.legalName,
      vatNumber: input.vat_number !== undefined ? input.vat_number : existing.vatNumber,
      status: input.status ?? existing.status,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, id))
    .returning();
  await writeAuditLog(db, {
    tenantId: id,
    action: 'admin.tenant.update',
    resource: 'tenant',
    resourceId: id,
  });
  return serializeTenant(row!);
}

export async function adminListTenantAccounts(db: Db, tenantId: string) {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) throw notFound('Tenant not found');
  const rows = await db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.tenantId, tenantId))
    .orderBy(asc(bankAccounts.name));
  return rows.map((row) => ({
    id: row.id,
    tenant_id: row.tenantId,
    name: row.name,
    iban: row.iban,
    currency: row.currency,
    account_type: row.accountType,
    status: row.status,
    last_provider_update_at: row.lastProviderUpdateAt?.toISOString() ?? null,
  }));
}

export async function adminListApplications(db: Db) {
  const apps = await db.select().from(applications).orderBy(asc(applications.name));
  const creds = await db.select().from(applicationCredentials);
  const perms = await db.select().from(applicationTenantPermissions);

  return apps.map((app) => {
    const appCreds = creds.filter((c) => c.applicationId === app.id);
    const active = appCreds.find((c) => c.status === 'active');
    const appPerms = perms.filter((p) => p.applicationId === app.id);
    return {
      id: app.id,
      name: app.name,
      status: app.status,
      created_at: app.createdAt.toISOString(),
      updated_at: app.updatedAt.toISOString(),
      key_prefix: active?.keyPrefix ?? null,
      last_used_at: active?.lastUsedAt?.toISOString() ?? null,
      credential_status: active?.status ?? 'none',
      permissions: appPerms.map((p) => ({
        id: p.id,
        tenant_id: p.tenantId,
        permissions: p.permissions ?? [],
      })),
    };
  });
}

export async function adminCreateApplication(
  db: Db,
  input: {
    name: string;
    tenant_id?: string;
    permissions?: string[];
  },
) {
  const permissions = (input.permissions ?? [...ALL_PERMISSIONS]).filter(isPermission);
  if (permissions.length === 0) throw badRequest('At least one valid permission required');

  const [app] = await db.insert(applications).values({ name: input.name }).returning();
  if (input.tenant_id) {
    await db.insert(applicationTenantPermissions).values({
      applicationId: app!.id,
      tenantId: input.tenant_id,
      permissions,
    });
  }
  const { rawKey, prefix } = generateApiKey();
  const keyHash = await hashApiKey(rawKey);
  await db.insert(applicationCredentials).values({
    applicationId: app!.id,
    keyPrefix: prefix,
    keyHash,
    status: 'active',
  });
  await writeAuditLog(db, {
    applicationId: app!.id,
    tenantId: input.tenant_id ?? null,
    action: 'admin.application.create',
    resource: 'application',
    resourceId: app!.id,
  });
  return {
    id: app!.id,
    name: app!.name,
    status: app!.status,
    api_key: rawKey,
    key_prefix: prefix,
  };
}

export async function adminSetAppPermissions(
  db: Db,
  applicationId: string,
  tenantId: string,
  permissions: string[],
) {
  const app = await db.query.applications.findFirst({ where: eq(applications.id, applicationId) });
  if (!app) throw notFound('Application not found');
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) throw notFound('Tenant not found');
  const perms = permissions.filter(isPermission);
  if (perms.length === 0) throw badRequest('At least one valid permission required');

  const [row] = await db
    .insert(applicationTenantPermissions)
    .values({ applicationId, tenantId, permissions: perms })
    .onConflictDoUpdate({
      target: [
        applicationTenantPermissions.applicationId,
        applicationTenantPermissions.tenantId,
      ],
      set: { permissions: perms },
    })
    .returning();

  await writeAuditLog(db, {
    applicationId,
    tenantId,
    action: 'admin.application.permissions',
    resource: 'application',
    resourceId: applicationId,
  });
  return {
    id: row!.id,
    application_id: row!.applicationId,
    tenant_id: row!.tenantId,
    permissions: row!.permissions,
  };
}

export async function adminRotateApiKey(db: Db, applicationId: string) {
  const app = await db.query.applications.findFirst({ where: eq(applications.id, applicationId) });
  if (!app) throw notFound('Application not found');

  await db
    .update(applicationCredentials)
    .set({ status: 'revoked' })
    .where(eq(applicationCredentials.applicationId, applicationId));

  const { rawKey, prefix } = generateApiKey();
  const keyHash = await hashApiKey(rawKey);
  await db.insert(applicationCredentials).values({
    applicationId,
    keyPrefix: prefix,
    keyHash,
    status: 'active',
  });
  await writeAuditLog(db, {
    applicationId,
    action: 'admin.application.rotate_key',
    resource: 'application',
    resourceId: applicationId,
  });
  return { application_id: applicationId, api_key: rawKey, key_prefix: prefix };
}

export async function adminRevokeCredentials(db: Db, applicationId: string) {
  const app = await db.query.applications.findFirst({ where: eq(applications.id, applicationId) });
  if (!app) throw notFound('Application not found');
  await db
    .update(applicationCredentials)
    .set({ status: 'revoked' })
    .where(eq(applicationCredentials.applicationId, applicationId));
  await writeAuditLog(db, {
    applicationId,
    action: 'admin.application.revoke',
    resource: 'application',
    resourceId: applicationId,
  });
  return { application_id: applicationId, credential_status: 'revoked' };
}

export async function adminListConnections(db: Db) {
  const rows = await db
    .select({
      connection: providerConnections,
      tenantName: tenants.name,
    })
    .from(providerConnections)
    .leftJoin(tenants, eq(tenants.id, providerConnections.tenantId))
    .orderBy(desc(providerConnections.updatedAt));

  return rows.map(({ connection: c, tenantName }) => ({
    id: c.id,
    tenant_id: c.tenantId,
    tenant_name: tenantName,
    provider: c.provider,
    workspace_id: c.workspaceId,
    status: c.status,
    last_sync_at: c.lastSyncAt?.toISOString() ?? null,
    last_sync_attempt_at: c.lastSyncAttemptAt?.toISOString() ?? null,
    last_successful_sync_at: c.lastSuccessfulSyncAt?.toISOString() ?? null,
    last_error: c.lastError,
    updated_at: c.updatedAt.toISOString(),
  }));
}

export async function adminUpsertConnection(
  db: Db,
  input: {
    tenant_id: string;
    workspace_id: string;
    token?: string;
    use_env_token?: boolean;
    status?: string;
  },
) {
  const config = getConfig();
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, input.tenant_id) });
  if (!tenant) throw notFound('Tenant not found');

  let token = input.token?.trim() ?? '';
  if (!token && input.use_env_token) {
    token = config.FINTABLE_API_TOKEN;
  }
  if (!token) {
    throw badRequest('Provide token or use_env_token with FINTABLE_API_TOKEN set');
  }

  const encrypted = encryptSecret(token, config.ENCRYPTION_KEY);
  const [row] = await db
    .insert(providerConnections)
    .values({
      tenantId: input.tenant_id,
      provider: 'fintable',
      workspaceId: input.workspace_id,
      encryptedCredentials: encrypted,
      status: input.status ?? 'active',
    })
    .onConflictDoUpdate({
      target: [providerConnections.provider, providerConnections.workspaceId],
      set: {
        tenantId: input.tenant_id,
        encryptedCredentials: encrypted,
        status: input.status ?? 'active',
        updatedAt: new Date(),
        lastError: null,
      },
    })
    .returning();

  await writeAuditLog(db, {
    tenantId: input.tenant_id,
    action: 'admin.connection.upsert',
    resource: 'provider_connection',
    resourceId: row!.id,
    metadata: { workspace_id: input.workspace_id },
  });

  return {
    id: row!.id,
    tenant_id: row!.tenantId,
    provider: row!.provider,
    workspace_id: row!.workspaceId,
    status: row!.status,
  };
}

export async function adminDeactivateConnection(db: Db, connectionId: string) {
  const existing = await db.query.providerConnections.findFirst({
    where: eq(providerConnections.id, connectionId),
  });
  if (!existing) throw notFound('Connection not found');
  const [row] = await db
    .update(providerConnections)
    .set({ status: 'inactive', updatedAt: new Date() })
    .where(eq(providerConnections.id, connectionId))
    .returning();
  await writeAuditLog(db, {
    tenantId: row!.tenantId,
    action: 'admin.connection.deactivate',
    resource: 'provider_connection',
    resourceId: connectionId,
  });
  return {
    id: row!.id,
    status: row!.status,
  };
}

export async function adminTriggerConnectionSync(db: Db, connectionId: string) {
  const result = await syncProviderConnection(db, connectionId);
  await writeAuditLog(db, {
    tenantId: result.tenantId || null,
    action: 'admin.connection.sync',
    resource: 'provider_connection',
    resourceId: connectionId,
    metadata: { status: result.status, job_id: result.jobId },
  });
  return result;
}

export async function adminListSyncJobs(
  db: Db,
  opts: { tenant_id?: string; limit?: number; cursor?: string } = {},
) {
  const limit = clampLimit(opts.limit, 50, 100);
  const conditions = [];
  if (opts.tenant_id) conditions.push(eq(syncJobs.tenantId, opts.tenant_id));
  if (opts.cursor) {
    let cursor;
    try {
      cursor = decodeCursor(opts.cursor);
    } catch {
      throw badRequest('Invalid cursor');
    }
    conditions.push(
      sql`(${syncJobs.createdAt}, ${syncJobs.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
    );
  }
  const rows = await db
    .select()
    .from(syncJobs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(syncJobs.createdAt), desc(syncJobs.id))
    .limit(limit + 1);

  const page = paginationResponse(rows, limit);
  return {
    data: page.data.map((j) => ({
      id: j.id,
      tenant_id: j.tenantId,
      provider_connection_id: j.providerConnectionId,
      status: j.status,
      started_at: j.startedAt?.toISOString() ?? null,
      completed_at: j.completedAt?.toISOString() ?? null,
      error_message: j.errorMessage,
      records_processed: j.recordsProcessed,
      created_at: j.createdAt.toISOString(),
    })),
    pagination: page.pagination,
  };
}

export async function adminListAuditLogs(
  db: Db,
  opts: {
    tenant_id?: string;
    action?: string;
    limit?: number;
    cursor?: string;
  } = {},
) {
  const limit = clampLimit(opts.limit, 50, 100);
  const conditions = [];
  if (opts.tenant_id) conditions.push(eq(auditLogs.tenantId, opts.tenant_id));
  if (opts.action) conditions.push(ilike(auditLogs.action, `%${opts.action}%`));
  if (opts.cursor) {
    let cursor;
    try {
      cursor = decodeCursor(opts.cursor);
    } catch {
      throw badRequest('Invalid cursor');
    }
    conditions.push(
      sql`(${auditLogs.timestamp}, ${auditLogs.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
    );
  }

  const rows = await db
    .select()
    .from(auditLogs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.timestamp), desc(auditLogs.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  let nextCursor: string | null = null;
  if (hasMore && last) {
    nextCursor = encodeCursor({
      createdAt: last.timestamp.toISOString(),
      id: last.id,
    });
  }

  return {
    data: data.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      application_id: row.applicationId,
      action: row.action,
      resource: row.resource,
      resource_id: row.resourceId,
      timestamp: row.timestamp.toISOString(),
      metadata: row.metadata ?? {},
    })),
    pagination: { next_cursor: nextCursor, has_more: hasMore },
  };
}

export async function adminListAccounts(
  db: Db,
  opts: { tenant_id?: string; status?: string; limit?: number } = {},
) {
  const limit = clampLimit(opts.limit, 100, 500);
  const conditions = [];
  if (opts.tenant_id) conditions.push(eq(bankAccounts.tenantId, opts.tenant_id));
  if (opts.status) conditions.push(eq(bankAccounts.status, opts.status));

  const rows = await db
    .select({
      account: bankAccounts,
      tenantName: tenants.name,
    })
    .from(bankAccounts)
    .leftJoin(tenants, eq(tenants.id, bankAccounts.tenantId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(tenants.name), asc(bankAccounts.name))
    .limit(limit);

  return rows.map(({ account, tenantName }) => ({
    id: account.id,
    tenant_id: account.tenantId,
    tenant_name: tenantName,
    name: account.name,
    iban: account.iban,
    currency: account.currency,
    account_type: account.accountType,
    status: account.status,
    last_provider_update_at: account.lastProviderUpdateAt?.toISOString() ?? null,
  }));
}

export async function adminListAllTenantIds(db: Db): Promise<string[]> {
  const rows = await db.select({ id: tenants.id }).from(tenants);
  return rows.map((r) => r.id);
}

export async function adminBrowseTransactions(
  db: Db,
  filters: Omit<TransactionFilters, 'tenantIds'> & { tenant_id?: string; q?: string },
) {
  const allIds = await adminListAllTenantIds(db);
  const tenantIds = filters.tenant_id
    ? allIds.filter((id) => id === filters.tenant_id)
    : allIds;
  return listTransactions(db, {
    ...filters,
    tenantIds,
    tenantId: filters.tenant_id,
    q: filters.q,
  });
}

export function transactionsToCsv(
  rows: Array<{
    id: string;
    tenant_id: string;
    bank_account_id: string;
    booking_date: string;
    value_date: string | null;
    amount: string;
    currency: string;
    description: string | null;
    counterparty_name: string | null;
    counterparty_iban: string | null;
    status: string;
  }>,
): string {
  const header = [
    'id',
    'tenant_id',
    'bank_account_id',
    'booking_date',
    'value_date',
    'amount',
    'currency',
    'description',
    'counterparty_name',
    'counterparty_iban',
    'status',
  ];
  const escape = (v: string | null | undefined) => {
    const s = v ?? '';
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.tenant_id,
        row.bank_account_id,
        row.booking_date,
        row.value_date,
        row.amount,
        row.currency,
        escape(row.description),
        escape(row.counterparty_name),
        escape(row.counterparty_iban),
        row.status,
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}
