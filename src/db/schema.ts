import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
  uniqueIndex,
  index,
  boolean,
  integer,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    vatNumber: text('vat_number'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tenants_status_idx').on(t.status)],
);

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('applications_status_idx').on(t.status)],
);

export const applicationCredentials = pgTable(
  'application_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('application_credentials_prefix_idx').on(t.keyPrefix),
    index('application_credentials_app_idx').on(t.applicationId),
  ],
);

export const applicationTenantPermissions = pgTable(
  'application_tenant_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('application_tenant_permissions_uniq').on(t.applicationId, t.tenantId),
    index('application_tenant_permissions_tenant_idx').on(t.tenantId),
  ],
);

export const providerConnections = pgTable(
  'provider_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('fintable'),
    workspaceId: text('workspace_id').notNull(),
    encryptedCredentials: text('encrypted_credentials').notNull(),
    status: text('status').notNull().default('active'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSyncAttemptAt: timestamp('last_sync_attempt_at', { withTimezone: true }),
    lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }),
    syncCursorUpdatedSince: timestamp('sync_cursor_updated_since', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('provider_connections_tenant_idx').on(t.tenantId),
    index('provider_connections_status_idx').on(t.status),
    uniqueIndex('provider_connections_workspace_uniq').on(t.provider, t.workspaceId),
  ],
);

export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    externalAccountId: text('external_account_id').notNull(),
    name: text('name').notNull(),
    iban: text('iban'),
    currency: text('currency').notNull(),
    accountType: text('account_type'),
    status: text('status').notNull().default('active'),
    lastProviderUpdateAt: timestamp('last_provider_update_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bank_accounts_external_uniq').on(t.providerConnectionId, t.externalAccountId),
    index('bank_accounts_tenant_idx').on(t.tenantId),
    index('bank_accounts_status_idx').on(t.status),
  ],
);

export const balances = pgTable(
  'balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'cascade' }),
    balanceType: text('balance_type').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull(),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('balances_tenant_idx').on(t.tenantId),
    index('balances_account_idx').on(t.bankAccountId),
    index('balances_as_of_idx').on(t.asOf),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'cascade' }),
    externalTransactionId: text('external_transaction_id').notNull(),
    bookingDate: text('booking_date').notNull(),
    valueDate: text('value_date'),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull(),
    description: text('description'),
    counterpartyName: text('counterparty_name'),
    counterpartyIban: text('counterparty_iban'),
    status: text('status').notNull().default('booked'),
    rawData: jsonb('raw_data').$type<Record<string, unknown>>(),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('transactions_external_uniq').on(t.bankAccountId, t.externalTransactionId),
    index('transactions_tenant_idx').on(t.tenantId),
    index('transactions_account_idx').on(t.bankAccountId),
    index('transactions_booking_date_idx').on(t.bookingDate),
    index('transactions_amount_idx').on(t.amount),
  ],
);

export const pendingTransactions = pgTable(
  'pending_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'cascade' }),
    bookingDate: text('booking_date').notNull(),
    amount: numeric('amount', { precision: 20, scale: 4 }).notNull(),
    currency: text('currency').notNull(),
    description: text('description'),
    counterpartyName: text('counterparty_name'),
    asOf: timestamp('as_of', { withTimezone: true }),
    supported: boolean('supported').notNull().default(true),
    snapshotPayload: jsonb('snapshot_payload').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pending_transactions_tenant_idx').on(t.tenantId),
    index('pending_transactions_account_idx').on(t.bankAccountId),
  ],
);

export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    providerConnectionId: uuid('provider_connection_id')
      .notNull()
      .references(() => providerConnections.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    recordsProcessed: integer('records_processed').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sync_jobs_tenant_idx').on(t.tenantId),
    index('sync_jobs_connection_idx').on(t.providerConnectionId),
    index('sync_jobs_status_idx').on(t.status),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    applicationId: uuid('application_id').references(() => applications.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceId: text('resource_id'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  },
  (t) => [
    index('audit_logs_tenant_idx').on(t.tenantId),
    index('audit_logs_application_idx').on(t.applicationId),
    index('audit_logs_timestamp_idx').on(t.timestamp),
  ],
);

/** Outbound webhook subscriptions (Phase 3 skeleton) */
export const webhookSubscriptions = pgTable(
  'webhook_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    /** AES-GCM encrypted HMAC signing secret */
    encryptedSecret: text('encrypted_secret').notNull(),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('active'),
    description: text('description'),
    lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
    lastDeliveryStatus: text('last_delivery_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('webhook_subscriptions_tenant_idx').on(t.tenantId),
    index('webhook_subscriptions_status_idx').on(t.status),
  ],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => webhookSubscriptions.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Stable id for idempotent enqueue + receiver dedupe (unique per subscription) */
    eventId: text('event_id').notNull(),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    httpStatus: integer('http_status'),
    responseBody: text('response_body'),
    errorMessage: text('error_message'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('webhook_deliveries_subscription_idx').on(t.subscriptionId),
    index('webhook_deliveries_tenant_idx').on(t.tenantId),
    index('webhook_deliveries_created_idx').on(t.createdAt),
    index('webhook_deliveries_pending_idx').on(t.status, t.nextAttemptAt),
    uniqueIndex('webhook_deliveries_sub_event_uidx').on(t.subscriptionId, t.eventId),
  ],
);

/** Singleton row for Admin UI TOTP MFA (shared ADMIN_PASSWORD operators) */
export const adminMfaSettings = pgTable('admin_mfa_settings', {
  id: text('id').primaryKey().default('default'),
  enabled: boolean('enabled').notNull().default(false),
  encryptedTotpSecret: text('encrypted_totp_secret'),
  pendingEncryptedSecret: text('pending_encrypted_secret'),
  recoveryCodeHashes: jsonb('recovery_code_hashes').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type ProviderConnection = typeof providerConnections.$inferSelect;
export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;
export type AdminMfaSettings = typeof adminMfaSettings.$inferSelect;
