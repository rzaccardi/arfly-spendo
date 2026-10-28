import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { createHmac } from 'node:crypto';
import type { Db } from '../../src/db/client.js';
import { buildApp } from '../../src/api/app.js';
import { createTestDb, createTenantApp } from '../helpers.js';
import { loadConfig, resetConfigCache } from '../../src/lib/config.js';
import { resetLoginGuardForTests } from '../../src/auth/login-guard.js';
import { base32Decode } from '../../src/auth/totp.js';
import { confirmAdminMfaSetup, startAdminMfaSetup } from '../../src/domain/admin-mfa.js';
import { eq } from 'drizzle-orm';
import { adminMfaSettings } from '../../src/db/schema.js';

function currentTotp(secretBase32: string): string {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

describe('Admin auth & routes', () => {
  let db: Db;
  let sql: ReturnType<typeof postgres>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let saasKey: string;
  let config: ReturnType<typeof loadConfig>;
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
    config = loadConfig({
      ADMIN_PASSWORD: adminPassword,
      ADMIN_API_KEY: adminApiKey,
      FINTABLE_DRY_RUN: 'true',
      LOG_LEVEL: 'error',
      ADMIN_LOGIN_MAX_ATTEMPTS: '3',
      ADMIN_LOGIN_WINDOW_MS: '600000',
      ADMIN_LOGIN_LOCKOUT_MS: '60000',
      ADMIN_LOGIN_RATE_MAX: '100',
    });
    app = await buildApp({ db, config, logger: false });
    await app.ready();
  });

  beforeEach(async () => {
    resetLoginGuardForTests();
    await db.delete(adminMfaSettings).where(eq(adminMfaSettings.id, 'default'));
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

  it('requires TOTP after password when MFA is enabled', async () => {
    const setup = await startAdminMfaSetup(db, config);
    const confirm = await confirmAdminMfaSetup(db, config, currentTotp(setup.secret));
    expect(confirm.recovery_codes.length).toBeGreaterThan(0);

    const step1 = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: adminPassword },
    });
    expect(step1.statusCode).toBe(200);
    expect(step1.json().data.mfa_required).toBe(true);
    expect(step1.headers['set-cookie']).toBeUndefined();
    const mfaToken = step1.json().data.mfa_token as string;

    const step2 = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { mfa_token: mfaToken, totp_code: currentTotp(setup.secret) },
    });
    expect(step2.statusCode).toBe(200);
    expect(step2.json().data.authenticated).toBe(true);
    expect(step2.headers['set-cookie']).toBeTruthy();
  });

  it('accepts one-shot password + totp when MFA enabled', async () => {
    const setup = await startAdminMfaSetup(db, config);
    await confirmAdminMfaSetup(db, config, currentTotp(setup.secret));

    const login = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: adminPassword, totp_code: currentTotp(setup.secret) },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data.authenticated).toBe(true);
  });

  it('locks out after repeated failed password attempts', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/api/login',
        payload: { password: 'wrong-password' },
        remoteAddress: '203.0.113.50',
      });
      expect([401, 429]).toContain(res.statusCode);
    }
    const locked = await app.inject({
      method: 'POST',
      url: '/admin/api/login',
      payload: { password: adminPassword },
      remoteAddress: '203.0.113.50',
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('rate_limited');
  });

  it('still allows ADMIN_API_KEY when MFA is enabled', async () => {
    const setup = await startAdminMfaSetup(db, config);
    await confirmAdminMfaSetup(db, config, currentTotp(setup.secret));

    const res = await app.inject({
      method: 'GET',
      url: '/admin/api/overview',
      headers: { authorization: `Bearer ${adminApiKey}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
