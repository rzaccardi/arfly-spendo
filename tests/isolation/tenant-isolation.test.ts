import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import type { Db } from '../../src/db/client.js';
import {
  buildTestApp,
  createTenantApp,
  createTestDb,
  seedAccountWithTx,
} from '../helpers.js';

describe('Tenant isolation', () => {
  let db: Db;
  let sql: ReturnType<typeof postgres>;
  let appAKey: string;
  let appBKey: string;
  let tenantAId: string;
  let tenantBId: string;
  let accountBId: string;
  let txBId: string;
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    const ctx = await createTestDb();
    db = ctx.db;
    sql = ctx.sql;

    const a = await createTenantApp(db, {
      tenantName: `Isolation A ${Date.now()}`,
      appName: `App Isolation A ${Date.now()}`,
    });
    const b = await createTenantApp(db, {
      tenantName: `Isolation B ${Date.now()}`,
      appName: `App Isolation B ${Date.now()}`,
    });
    appAKey = a.apiKey;
    appBKey = b.apiKey;
    tenantAId = a.tenant.id;
    tenantBId = b.tenant.id;

    await seedAccountWithTx(db, tenantAId, { amount: '-10.00' });
    const seededB = await seedAccountWithTx(db, tenantBId, { amount: '-99.00' });
    accountBId = seededB.account.id;
    txBId = seededB.transaction.id;

    app = await buildTestApp(db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('App A cannot list Tenant B accounts via tenant_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/accounts?tenant_id=${tenantBId}`,
      headers: { authorization: `Bearer ${appAKey}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('App A cannot read Tenant B account by forged id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/accounts/${accountBId}`,
      headers: { authorization: `Bearer ${appAKey}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('App A cannot read Tenant B transaction by forged id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/transactions/${txBId}`,
      headers: { authorization: `Bearer ${appAKey}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('App A list accounts only returns Tenant A', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/accounts',
      headers: { authorization: `Bearer ${appAKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ tenant_id: string }> };
    expect(body.data.every((a) => a.tenant_id === tenantAId)).toBe(true);
    expect(body.data.some((a) => a.tenant_id === tenantBId)).toBe(false);
  });

  it('App B can read its own account', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/accounts/${accountBId}`,
      headers: { authorization: `Bearer ${appBKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.tenant_id).toBe(tenantBId);
  });
});
