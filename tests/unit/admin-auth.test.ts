import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import type { Db } from '../../src/db/client.js';
import { buildApp } from '../../src/api/app.js';
import { createTestDb, createTenantApp } from '../helpers.js';
import { loadConfig, resetConfigCache } from '../../src/lib/config.js';

describe('Admin auth & routes', () => {
  let db: Db;
  let sql: ReturnType<typeof postgres>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let saasKey: string;
  const adminPassword = 'test-admin-password-spendo';
  const adminApiKey = 'test-admin-api-key-spendo';

  beforeAll(async () => {
    const ctx = await createTestDb();
    db = ctx.db;
    sql = ctx.sql;

    const seeded = await createTenantApp(db, {
      tenantName: `Admin Test ${Date.now()}`,
      appName: `Admin Test App ${Date.now()}`,
    });
    saasKey = seeded.apiKey;

    resetConfigCache();
    const config = loadConfig({
      ADMIN_PASSWORD: adminPassword,
      ADMIN_API_KEY: adminApiKey,
      FINTABLE_DRY_RUN: 'true',
      LOG_LEVEL: 'error',
    });
    app = await buildApp({ db, config, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    resetConfigCache();
  });

  it('rejects admin overview without credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/api/overview' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects SaaS API key on admin routes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/api/overview',
      headers: { authorization: `Bearer ${saasKey}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts ADMIN_API_KEY bearer on admin routes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/api/overview',
      headers: { authorization: `Bearer ${adminApiKey}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.data.tenants).toBe('number');
    expect(typeof body.data.accounts).toBe('number');
  });

  it('logs in with ADMIN_PASSWORD and sets session cookie', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: adminPassword },
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookie).toContain('spendo_admin_session=');

    const me = await app.inject({
      method: 'GET',
      url: '/admin/api/me',
      headers: { cookie: cookie!.split(';')[0]! },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.authenticated).toBe(true);
  });

  it('rejects wrong admin password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('keeps /v1 SaaS auth unchanged', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tenants',
      headers: { authorization: `Bearer ${saasKey}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('does not expose encrypted credentials on connections list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/api/connections',
      headers: { authorization: `Bearer ${adminApiKey}` },
    });
    expect(res.statusCode).toBe(200);
    const text = res.body;
    expect(text).not.toContain('encrypted');
    expect(text).not.toContain('encrypted_credentials');
  });
});
