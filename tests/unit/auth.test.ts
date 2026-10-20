import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import type { Db } from '../../src/db/client.js';
import { buildTestApp, createTenantApp, createTestDb } from '../helpers.js';

describe('API key auth & permissions', () => {
  let db: Db;
  let sql: ReturnType<typeof postgres>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let fullKey: string;
  let readOnlyKey: string;

  beforeAll(async () => {
    const ctx = await createTestDb();
    db = ctx.db;
    sql = ctx.sql;

    const full = await createTenantApp(db, {
      tenantName: `Auth Full ${Date.now()}`,
      appName: `Auth Full App ${Date.now()}`,
    });
    const readOnly = await createTenantApp(db, {
      tenantName: `Auth RO ${Date.now()}`,
      appName: `Auth RO App ${Date.now()}`,
      permissions: ['accounts:read'],
    });
    fullKey = full.apiKey;
    readOnlyKey = readOnly.apiKey;

    app = await buildTestApp(db);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
  });

  it('rejects missing Authorization', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/tenants' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects invalid API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tenants',
      headers: { authorization: 'Bearer spk_this_is_not_a_valid_key_xxxxx' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts valid API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tenants',
      headers: { authorization: `Bearer ${fullKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it('enforces sync:request permission', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sync/request',
      headers: {
        authorization: `Bearer ${readOnlyKey}`,
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('health is public', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('Spendo');
  });
});
