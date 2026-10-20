import { eq } from 'drizzle-orm';
import { createDb, type Db } from '../src/db/client.js';
import {
  applications,
  applicationCredentials,
  applicationTenantPermissions,
  bankAccounts,
  balances,
  providerConnections,
  tenants,
  transactions,
} from '../src/db/schema.js';
import { generateApiKey, hashApiKey } from '../src/auth/api-keys.js';
import { encryptSecret } from '../src/lib/crypto.js';
import { loadConfig, resetConfigCache } from '../src/lib/config.js';
import { buildApp } from '../src/api/app.js';
import { ALL_PERMISSIONS, type Permission } from '../src/auth/permissions.js';
import { upsertTransaction } from '../src/domain/sync.js';

export async function createTestDb() {
  resetConfigCache();
  const config = loadConfig({
    FINTABLE_DRY_RUN: 'true',
    FINTABLE_API_TOKEN: '',
    LOG_LEVEL: 'error',
  });
  const { db, sql } = createDb(config.DATABASE_URL);
  return { db, sql, config };
}

export async function createTenantApp(db: Db, opts: {
  tenantName: string;
  appName: string;
  permissions?: Permission[];
}) {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: opts.tenantName, status: 'active' })
    .returning();
  const [app] = await db
    .insert(applications)
    .values({ name: opts.appName, status: 'active' })
    .returning();
  await db.insert(applicationTenantPermissions).values({
    applicationId: app!.id,
    tenantId: tenant!.id,
    permissions: opts.permissions ?? [...ALL_PERMISSIONS],
  });
  const { rawKey, prefix } = generateApiKey();
  const keyHash = await hashApiKey(rawKey);
  await db.insert(applicationCredentials).values({
    applicationId: app!.id,
    keyPrefix: prefix,
    keyHash,
    status: 'active',
  });
  return { tenant: tenant!, app: app!, apiKey: rawKey };
}

export async function seedAccountWithTx(
  db: Db,
  tenantId: string,
  opts?: { amount?: string; externalTxId?: string },
) {
  const config = loadConfig();
  const [conn] = await db
    .insert(providerConnections)
    .values({
      tenantId,
      provider: 'fintable',
      workspaceId: `ws_test_${tenantId.slice(0, 8)}_${Math.random().toString(36).slice(2, 8)}`,
      encryptedCredentials: encryptSecret('test-token', config.ENCRYPTION_KEY),
      status: 'active',
    })
    .returning();

  const [account] = await db
    .insert(bankAccounts)
    .values({
      tenantId,
      providerConnectionId: conn!.id,
      externalAccountId: `acc_${Math.random().toString(36).slice(2, 10)}`,
      name: 'Test Account',
      iban: 'IT60X0542811101000000123456',
      currency: 'EUR',
      accountType: 'checking',
      status: 'active',
    })
    .returning();

  await db.insert(balances).values({
    tenantId,
    bankAccountId: account!.id,
    balanceType: 'booked',
    amount: '1000.00',
    currency: 'EUR',
    asOf: new Date(),
  });

  const externalTxId = opts?.externalTxId ?? `tx_${Math.random().toString(36).slice(2, 10)}`;
  await upsertTransaction(db, {
    tenantId,
    bankAccountId: account!.id,
    externalTransactionId: externalTxId,
    bookingDate: '2026-01-15',
    valueDate: '2026-01-15',
    amount: opts?.amount ?? '-25.50',
    currency: 'EUR',
    description: 'Coffee',
    counterpartyName: 'Cafe',
    counterpartyIban: null,
    status: 'booked',
    rawData: { id: externalTxId },
    providerUpdatedAt: new Date('2026-01-15T10:00:00Z'),
  });

  const tx = await db.query.transactions.findFirst({
    where: eq(transactions.bankAccountId, account!.id),
  });

  return { connection: conn!, account: account!, transaction: tx! };
}

export async function buildTestApp(db: Db) {
  const config = loadConfig({ LOG_LEVEL: 'error', FINTABLE_DRY_RUN: 'true' });
  return buildApp({ db, config, logger: false });
}
