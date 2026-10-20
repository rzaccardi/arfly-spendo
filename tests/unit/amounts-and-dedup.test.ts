import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type postgres from 'postgres';
import type { Db } from '../../src/db/client.js';
import { transactions } from '../../src/db/schema.js';
import { sumDecimals, toDecimalString, compareDecimal } from '../../src/lib/amounts.js';
import { upsertTransaction } from '../../src/domain/sync.js';
import { createTenantApp, createTestDb, seedAccountWithTx } from '../helpers.js';
import { encryptSecret, decryptSecret } from '../../src/lib/crypto.js';
import { loadConfig } from '../../src/lib/config.js';
import {
  mapFintableTransaction,
  mapFintableAccount,
} from '../../src/providers/fintable/mapper.js';

describe('Amount handling', () => {
  it('keeps decimal strings without float conversion', () => {
    expect(toDecimalString('1234.56')).toBe('1234.56');
    expect(toDecimalString('-4.50')).toBe('-4.5');
    expect(typeof toDecimalString('-4.50')).toBe('string');
    expect(sumDecimals(['10.10', '0.20'])).toBe('10.3');
    expect(compareDecimal('0.1', '0.10')).toBe(0);
  });

  it('maps Fintable amounts as strings', () => {
    const tx = mapFintableTransaction({
      id: 'tx_1',
      date: '2026-01-01',
      amount: '-4.50',
      currency: 'EUR',
      description: 'TEST',
      merchant: 'Shop',
      updated_at: '2026-01-02T00:00:00Z',
    });
    expect(tx.amount).toBe('-4.5');
    expect(typeof tx.amount).toBe('string');

    const acc = mapFintableAccount({
      id: 'acc_1',
      name: 'Checking',
      currency: 'EUR',
      balance: '5240.12',
      balance_available: '5190.12',
      enabled: true,
    });
    expect(acc.balance).toBe('5240.12');
  });

  it('encrypts and decrypts secrets with AES-256-GCM', () => {
    const key = loadConfig().ENCRYPTION_KEY;
    const enc = encryptSecret('pat_secret_value', key);
    expect(enc).not.toContain('pat_secret');
    expect(decryptSecret(enc, key)).toBe('pat_secret_value');
  });
});

describe('Transaction dedup upsert', () => {
  let db: Db;
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    const ctx = await createTestDb();
    db = ctx.db;
    sql = ctx.sql;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('upserts by (bank_account_id, external_transaction_id)', async () => {
    const { tenant } = await createTenantApp(db, {
      tenantName: `Dedup ${Date.now()}`,
      appName: `Dedup App ${Date.now()}`,
    });
    const { account } = await seedAccountWithTx(db, tenant.id, {
      externalTxId: 'tx_stable_1',
      amount: '-10.00',
    });

    const secondResult = await upsertTransaction(db, {
      tenantId: tenant.id,
      bankAccountId: account.id,
      externalTransactionId: 'tx_stable_1',
      bookingDate: '2026-01-16',
      valueDate: '2026-01-16',
      amount: '-12.00',
      currency: 'EUR',
      description: 'Updated',
      counterpartyName: 'Cafe',
      counterpartyIban: null,
      status: 'booked',
      rawData: { id: 'tx_stable_1', version: 2 },
      providerUpdatedAt: new Date('2026-01-16T10:00:00Z'),
    });
    expect(secondResult.outcome).toBe('updated');

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.bankAccountId, account.id));
    const matches = rows.filter((r) => r.externalTransactionId === 'tx_stable_1');
    expect(matches).toHaveLength(1);
    expect(toDecimalString(matches[0]!.amount)).toBe('-12');
    expect(matches[0]!.description).toBe('Updated');
  });
});
