import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import type { Db } from '../../src/db/client.js';
import { buildCashflow } from '../../src/domain/summary.js';
import { createTenantApp, createTestDb, seedAccountWithTx } from '../helpers.js';
import { upsertTransaction } from '../../src/domain/sync.js';

describe('Cashflow', () => {
  let db: Db;
  let sql: postgres.Sql;

  beforeAll(async () => {
    ({ db, sql } = await createTestDb());
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('keeps currencies separate and buckets by month', async () => {
    const { tenant } = await createTenantApp(db, {
      tenantName: `Cf Tenant ${Date.now()}`,
      appName: `Cf App ${Date.now()}`,
    });
    const { account } = await seedAccountWithTx(db, tenant.id, {
      amount: '100.00',
      externalTxId: `cf_in_${Date.now()}`,
    });

    await upsertTransaction(db, {
      tenantId: tenant.id,
      bankAccountId: account.id,
      externalTransactionId: `cf_out_${Date.now()}`,
      bookingDate: '2026-03-15',
      valueDate: '2026-03-15',
      amount: '-40.00',
      currency: 'EUR',
      description: 'Out',
      counterpartyName: null,
      counterpartyIban: null,
      status: 'booked',
      rawData: null,
      providerUpdatedAt: null,
    });

    await upsertTransaction(db, {
      tenantId: tenant.id,
      bankAccountId: account.id,
      externalTransactionId: `cf_usd_${Date.now()}`,
      bookingDate: '2026-03-20',
      valueDate: '2026-03-20',
      amount: '10.00',
      currency: 'USD',
      description: 'Usd',
      counterpartyName: null,
      counterpartyIban: null,
      status: 'booked',
      rawData: null,
      providerUpdatedAt: null,
    });

    const data = await buildCashflow(db, {
      tenantIds: [tenant.id],
      tenantId: tenant.id,
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      granularity: 'month',
    });

    expect(data.by_currency.EUR).toBeTruthy();
    expect(data.by_currency.USD).toBeTruthy();
    // Never a mixed total key
    expect(Object.keys(data.by_currency).sort()).toEqual(['EUR', 'USD']);
    expect(Number(data.by_currency.EUR!.totals.outflow)).toBeGreaterThan(0);
  });
});
