import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import type { AppConfig } from '../../lib/config.js';
import {
  adminSessionCookie,
  clearAdminSessionCookie,
  createAdminSessionToken,
  createMfaChallengeToken,
  isAdminAuthenticated,
  verifyAdminApiKey,
  verifyAdminPassword,
  verifyMfaChallengeToken,
} from '../../auth/admin.js';
import {
  assertAdminLoginAllowed,
  clearAdminLoginFailures,
  loginFailureDelayMs,
  recordAdminLoginFailure,
  sleep,
  throwInvalidCredentials,
} from '../../auth/login-guard.js';
import { unauthorized } from '../../lib/errors.js';
import { ALL_PERMISSIONS } from '../../auth/permissions.js';
import {
  adminBrowseTransactions,
  adminCreateApplication,
  adminCreateTenant,
  adminDeactivateConnection,
  adminListAccounts,
  adminListApplications,
  adminListAuditLogs,
  adminListConnections,
  adminListSyncJobs,
  adminListTenantAccounts,
  adminListTenants,
  adminOverview,
  adminRevokeCredentials,
  adminRotateApiKey,
  adminSetAppPermissions,
  adminListFintableWorkspaces,
  adminTriggerConnectionSync,
  adminUpdateConnection,
  adminUpdateTenant,
  adminUpsertConnection,
  transactionsToCsv,
} from '../../domain/admin.js';
import {
  confirmAdminMfaSetup,
  disableAdminMfa,
  getAdminMfaStatus,
  isAdminMfaEnabled,
  regenerateAdminRecoveryCodes,
  startAdminMfaSetup,
  verifyAdminMfaFactor,
} from '../../domain/admin-mfa.js';
import {
  attemptWebhookDelivery,
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDeliveries,
  listWebhookSubscriptions,
  processPendingWebhookDeliveries,
  WEBHOOK_EVENTS,
} from '../../domain/webhooks.js';
import { buildCashflow } from '../../domain/summary.js';
import { writeAuditLog } from '../../lib/audit.js';

function requireAdmin(config: AppConfig, request: { headers: Record<string, unknown> }) {
  const ok = isAdminAuthenticated(config, {
    authorization: request.headers.authorization as string | undefined,
    cookie: request.headers.cookie as string | undefined,
  });
  if (!ok) throw unauthorized('Admin authentication required');
}

export async function adminRoutes(
  app: FastifyInstance,
  db: Db,
  config: AppConfig,
): Promise<void> {
  const secure = config.NODE_ENV === 'production';

  app.get('/admin/api/health', async () => ({
    ok: true,
    service: 'Spendo Admin',
    auth_configured: config.hasAdminAuth,
  }));

  app.post(
    '/admin/api/login',
    {
      config: {
        rateLimit: {
          max: config.ADMIN_LOGIN_RATE_MAX,
          timeWindow: config.ADMIN_LOGIN_RATE_WINDOW_MS,
        },
      },
    },
    async (request, reply) => {
      if (!config.hasAdminAuth) {
        throw unauthorized('Admin auth not configured (set ADMIN_PASSWORD or ADMIN_API_KEY)');
      }
      const body = z
        .object({
          password: z.string().min(1).optional(),
          api_key: z.string().min(1).optional(),
          mfa_token: z.string().min(1).optional(),
          totp_code: z.string().min(1).optional(),
          recovery_code: z.string().min(1).optional(),
        })
        .parse(request.body ?? {});

      const ip = request.ip;
      assertAdminLoginAllowed(config, ip);

      const issueSession = async (meta?: Record<string, unknown>) => {
        clearAdminLoginFailures(ip);
        const token = createAdminSessionToken(config);
        const maxAge = config.ADMIN_SESSION_TTL_HOURS * 3600;
        reply.header('set-cookie', adminSessionCookie(token, maxAge, secure));
        await writeAuditLog(db, {
          action: 'admin.login',
          resource: 'admin',
          metadata: meta,
        });
        return {
          data: {
            authenticated: true,
            mfa_required: false,
            expires_in_hours: config.ADMIN_SESSION_TTL_HOURS,
          },
        };
      };

      const failLogin = async (): Promise<never> => {
        const result = recordAdminLoginFailure(config, ip);
        await sleep(loginFailureDelayMs(result.failures || config.ADMIN_LOGIN_MAX_ATTEMPTS));
        await writeAuditLog(db, {
          action: 'admin.login.failed',
          resource: 'admin',
          metadata: { locked: result.locked },
        });
        throwInvalidCredentials({
          locked: result.locked,
          retryAfterSeconds: result.retryAfterSeconds,
        });
      };

      // Step 2: MFA challenge completion (password already verified)
      if (body.mfa_token) {
        if (!verifyMfaChallengeToken(config, body.mfa_token)) {
          await failLogin();
        }
        const mfaOk = await verifyAdminMfaFactor(db, config, {
          totpCode: body.totp_code,
          recoveryCode: body.recovery_code,
        });
        if (!mfaOk) {
          await failLogin();
        }
        return issueSession({ mfa: true });
      }

      const passwordOk = body.password ? verifyAdminPassword(config, body.password) : false;
      const keyOk = body.api_key ? verifyAdminApiKey(config, body.api_key) : false;

      if (!passwordOk && !keyOk) {
        await failLogin();
      }

      // Bearer ADMIN_API_KEY bypasses TOTP (machine / automation)
      if (keyOk && !passwordOk) {
        return issueSession({ mode: 'api_key' });
      }

      const mfaEnabled = await isAdminMfaEnabled(db);
      if (mfaEnabled) {
        if (body.totp_code || body.recovery_code) {
          const mfaOk = await verifyAdminMfaFactor(db, config, {
            totpCode: body.totp_code,
            recoveryCode: body.recovery_code,
          });
          if (!mfaOk) {
            await failLogin();
          }
          return issueSession({ mfa: true });
        }
        const mfaToken = createMfaChallengeToken(config);
        await writeAuditLog(db, {
          action: 'admin.login.mfa_required',
          resource: 'admin',
        });
        return {
          data: {
            authenticated: false,
            mfa_required: true,
            mfa_token: mfaToken,
            expires_in_seconds: config.ADMIN_MFA_CHALLENGE_TTL_SECONDS,
          },
        };
      }

      return issueSession({ mode: 'password' });
    },
  );

  app.post('/admin/api/logout', async (_request, reply) => {
    reply.header('set-cookie', clearAdminSessionCookie(secure));
    return { data: { authenticated: false } };
  });

  app.get('/admin/api/me', async (request) => {
    requireAdmin(config, request);
    const mfa = await getAdminMfaStatus(db);
    return {
      data: {
        authenticated: true,
        auth_modes: {
          password: Boolean(config.ADMIN_PASSWORD),
          api_key: Boolean(config.adminApiKey),
        },
        mfa,
      },
    };
  });

  app.get('/admin/api/mfa', async (request) => {
    requireAdmin(config, request);
    return { data: await getAdminMfaStatus(db) };
  });

  app.post('/admin/api/mfa/setup', async (request) => {
    requireAdmin(config, request);
    const data = await startAdminMfaSetup(db, config);
    await writeAuditLog(db, { action: 'admin.mfa.setup_started', resource: 'admin' });
    return { data };
  });

  app.post('/admin/api/mfa/confirm', async (request) => {
    requireAdmin(config, request);
    const body = z.object({ totp_code: z.string().min(6).max(8) }).parse(request.body ?? {});
    const data = await confirmAdminMfaSetup(db, config, body.totp_code);
    await writeAuditLog(db, { action: 'admin.mfa.enabled', resource: 'admin' });
    return { data };
  });

  app.post('/admin/api/mfa/disable', async (request) => {
    requireAdmin(config, request);
    const body = z
      .object({
        password: z.string().min(1),
        totp_code: z.string().min(1).optional(),
        recovery_code: z.string().min(1).optional(),
      })
      .refine((b) => Boolean(b.totp_code || b.recovery_code), {
        message: 'totp_code or recovery_code required',
      })
      .parse(request.body ?? {});
    if (!verifyAdminPassword(config, body.password)) {
      throw unauthorized('Invalid admin credentials');
    }
    await disableAdminMfa(db, config, {
      totpCode: body.totp_code,
      recoveryCode: body.recovery_code,
    });
    await writeAuditLog(db, { action: 'admin.mfa.disabled', resource: 'admin' });
    return { data: { enabled: false } };
  });

  app.post('/admin/api/mfa/recovery-codes', async (request) => {
    requireAdmin(config, request);
    const body = z.object({ totp_code: z.string().min(6).max(8) }).parse(request.body ?? {});
    const data = await regenerateAdminRecoveryCodes(db, config, body.totp_code);
    await writeAuditLog(db, { action: 'admin.mfa.recovery_regenerated', resource: 'admin' });
    return { data };
  });

  // --- Overview ---
  app.get('/admin/api/overview', async (request) => {
    requireAdmin(config, request);
    return { data: await adminOverview(db) };
  });

  // --- Tenants ---
  app.get('/admin/api/tenants', async (request) => {
    requireAdmin(config, request);
    return { data: await adminListTenants(db) };
  });

  app.post('/admin/api/tenants', async (request) => {
    requireAdmin(config, request);
    const body = z
      .object({
        name: z.string().min(1),
        legal_name: z.string().nullable().optional(),
        vat_number: z.string().nullable().optional(),
        status: z.string().optional(),
      })
      .parse(request.body ?? {});
    return { data: await adminCreateTenant(db, body) };
  });

  app.patch('/admin/api/tenants/:id', async (request) => {
    requireAdmin(config, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        legal_name: z.string().nullable().optional(),
        vat_number: z.string().nullable().optional(),
        status: z.string().optional(),
      })
      .parse(request.body ?? {});
    return { data: await adminUpdateTenant(db, id, body) };
  });

  app.get('/admin/api/tenants/:id/accounts', async (request) => {
    requireAdmin(config, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { data: await adminListTenantAccounts(db, id) };
  });

  // --- Applications ---
  app.get('/admin/api/applications', async (request) => {
    requireAdmin(config, request);
    return { data: await adminListApplications(db) };
  });

  app.post('/admin/api/applications', async (request) => {
    requireAdmin(config, request);
    const body = z
      .object({
        name: z.string().min(1),
        tenant_id: z.string().uuid().optional(),
        permissions: z.array(z.string()).optional(),
      })
      .parse(request.body ?? {});
    return { data: await adminCreateApplication(db, body) };
  });

  app.put('/admin/api/applications/:id/permissions', async (request) => {
    requireAdmin(config, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        tenant_id: z.string().uuid(),
        permissions: z.array(z.string()).default([...ALL_PERMISSIONS]),
      })
      .parse(request.body ?? {});
    return {
      data: await adminSetAppPermissions(db, id, body.tenant_id, body.permissions),
    };
  });

  app.post('/admin/api/applications/:id/rotate-key', async (request) => {
    requireAdmin(config, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { data: await adminRotateApiKey(db, id) };
  });

  app.post('/admin/api/applications/:id/revoke', async (request) => {
    requireAdmin(config, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { data: await adminRevokeCredentials(db, id) };
  });

  // --- Connections ---
  app.get('/admin/api/connections', async (request) => {
    requireAdmin(config, request);
    return { data: await adminListConnections(db) };
  });

  app.post('/admin/api/connections', async (request) => {
    requireAdmin(config, request);
    const body = z
      .object({
        tenant_id: z.string().uuid(),
        workspace_id: z.string().min(1),
        token: z.string().optional(),
        use_env_token: z.boolean().optional(),
        status: z.string().optional(),
      })
      .parse(request.body ?? {});
    return { data: await adminUpsertConnection(db, body) };
  });

  app.get('/admin/api/fintable/workspaces', async (request) => {
    requireAdmin(config, request);
    return { data: await adminListFintableWorkspaces() };
  });

  app.patch('/admin/api/connections/:id', async (request) => {
    requireAdmin(config, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        tenant_id: z.string().uuid().optional(),
        workspace_id: z.string().min(1).optional(),
        token: z.string().optional(),
        use_env_token: z.boolean().optional(),
        status: z.enum(['active', 'inactive']).optional(),
      })
      .parse(request.body ?? {});
    return { data: await adminUpdateConnection(db, id, body) };
  });

  app.post('/admin/api/connections/:id/sync', async (request) => {
    requireAdmin(config, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { data: await adminTriggerConnectionSync(db, id) };
  });

  app.post('/admin/api/connections/:id/deactivate', async (request) => {
    requireAdmin(config, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { data: await adminDeactivateConnection(db, id) };
  });

  // --- Sync jobs ---
  app.get('/admin/api/sync-jobs', async (request) => {
    requireAdmin(config, request);
    const query = z
      .object({
        tenant_id: z.string().uuid().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
      })
      .parse(request.query);
    return await adminListSyncJobs(db, query);
  });

  app.post('/admin/api/sync-jobs/trigger', async (request) => {
    requireAdmin(config, request);
    const body = z
      .object({
        provider_connection_id: z.string().uuid(),
      })
      .parse(request.body ?? {});
    return { data: await adminTriggerConnectionSync(db, body.provider_connection_id) };
  });

  // --- Audit ---
  app.get('/admin/api/audit-logs', async (request) => {
    requireAdmin(config, request);
    const query = z
      .object({
        tenant_id: z.string().uuid().optional(),
        action: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().positive().max(100).optional(),
      })
      .parse(request.query);
    return await adminListAuditLogs(db, query);
  });

  // --- Accounts & transactions browse ---
  app.get('/admin/api/accounts', async (request) => {
    requireAdmin(config, request);
    const query = z
      .object({
        tenant_id: z.string().uuid().optional(),
        status: z.string().optional(),
        limit: z.coerce.number().int().positive().max(500).optional(),
      })
      .parse(request.query);
    return { data: await adminListAccounts(db, query) };
  });

  app.get('/admin/api/transactions', async (request, reply) => {
    requireAdmin(config, request);
    const query = z
      .object({
        tenant_id: z.string().uuid().optional(),
        account_id: z.string().uuid().optional(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        type: z.enum(['credit', 'debit']).optional(),
        status: z.string().optional(),
        min_amount: z.string().optional(),
        max_amount: z.string().optional(),
        q: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().positive().max(5000).optional(),
        format: z.enum(['json', 'csv']).optional(),
      })
      .parse(request.query);

    const result = await adminBrowseTransactions(db, {
      tenant_id: query.tenant_id,
      accountId: query.account_id,
      dateFrom: query.date_from,
      dateTo: query.date_to,
      type: query.type,
      status: query.status,
      minAmount: query.min_amount,
      maxAmount: query.max_amount,
      q: query.q,
      cursor: query.cursor,
      limit: query.format === 'csv' ? 5000 : query.limit,
    });

    if (query.format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="spendo-transactions.csv"');
      return transactionsToCsv(result.data);
    }
    return result;
  });

  // --- Webhooks (Phase 3 skeleton) ---
  app.get('/admin/api/webhooks', async (request) => {
    requireAdmin(config, request);
    const query = z.object({ tenant_id: z.string().uuid().optional() }).parse(request.query);
    return {
      data: await listWebhookSubscriptions(db, query.tenant_id),
      meta: { events: WEBHOOK_EVENTS },
    };
  });

  app.post('/admin/api/webhooks', async (request) => {
    requireAdmin(config, request);
    const body = z
      .object({
        tenant_id: z.string().uuid(),
        url: z.string().url(),
        events: z.array(z.string()).min(1),
        description: z.string().nullable().optional(),
        secret: z.string().optional(),
      })
      .parse(request.body ?? {});
    return { data: await createWebhookSubscription(db, body) };
  });

  app.delete('/admin/api/webhooks/:id', async (request) => {
    requireAdmin(config, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { data: await deleteWebhookSubscription(db, id) };
  });

  app.post('/admin/api/webhooks/:id/test', async (request) => {
    requireAdmin(config, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        event: z.string().default('sync.completed'),
        payload: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(request.body ?? {});
    return {
      data: await attemptWebhookDelivery(db, id, body.event, body.payload ?? { test: true }),
    };
  });

  app.get('/admin/api/webhooks/:id/deliveries', async (request) => {
    requireAdmin(config, request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { data: await listWebhookDeliveries(db, id) };
  });

  app.post('/admin/api/webhooks/process-pending', async (request) => {
    requireAdmin(config, request);
    const body = z
      .object({ limit: z.number().int().positive().max(100).optional() })
      .parse(request.body ?? {});
    return { data: await processPendingWebhookDeliveries(db, { limit: body.limit }) };
  });

  app.get('/admin/api/cashflow', async (request) => {
    requireAdmin(config, request);
    const query = z
      .object({
        tenant_id: z.string().uuid(),
        date_from: z.string().optional(),
        date_to: z.string().optional(),
        granularity: z.enum(['day', 'week', 'month']).optional().default('month'),
      })
      .parse(request.query);
    return {
      data: await buildCashflow(db, {
        tenantIds: [query.tenant_id],
        tenantId: query.tenant_id,
        dateFrom: query.date_from,
        dateTo: query.date_to,
        granularity: query.granularity,
      }),
    };
  });
}
