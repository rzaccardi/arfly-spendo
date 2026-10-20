import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { requireAuth } from '../auth-middleware.js';
import { accessibleTenantIds, resolveListTenantFilter } from '../../auth/context.js';
import {
  getAccount,
  listAccountBalances,
  listAccounts,
} from '../../domain/accounts.js';
import { writeAuditLog } from '../../lib/audit.js';
import { forbidden } from '../../lib/errors.js';

const querySchema = z.object({
  tenant_id: z.string().uuid().optional(),
  currency: z.string().min(3).max(3).optional(),
  status: z.string().optional(),
});

export async function accountRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get(
    '/v1/accounts',
    {
      schema: {
        tags: ['Accounts'],
        summary: 'List bank accounts',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const query = querySchema.parse(request.query);
      const tenantId = resolveListTenantFilter(auth, 'accounts:read', query.tenant_id);
      const data = await listAccounts(db, {
        tenantIds: [tenantId],
        tenantId,
        currency: query.currency,
        status: query.status,
      });
      await writeAuditLog(db, {
        applicationId: auth.applicationId,
        tenantId,
        action: 'accounts.list',
        resource: 'account',
        metadata: { count: data.length },
      });
      return { data };
    },
  );

  app.get(
    '/v1/accounts/:id',
    {
      schema: {
        tags: ['Accounts'],
        summary: 'Get account by id',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const tenantIds = accessibleTenantIds(auth, 'accounts:read');
      const data = await getAccount(db, id, tenantIds);
      await writeAuditLog(db, {
        applicationId: auth.applicationId,
        tenantId: data.tenant_id,
        action: 'accounts.get',
        resource: 'account',
        resourceId: id,
      });
      return { data };
    },
  );

  app.get(
    '/v1/accounts/:id/balances',
    {
      schema: {
        tags: ['Accounts'],
        summary: 'Get latest balances for an account',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const tenantIds = accessibleTenantIds(auth, 'balances:read');
      if (tenantIds.length === 0) {
        throw forbidden('Missing balances:read permission');
      }
      const data = await listAccountBalances(db, id, tenantIds);
      await writeAuditLog(db, {
        applicationId: auth.applicationId,
        action: 'balances.list',
        resource: 'balance',
        resourceId: id,
      });
      return { data };
    },
  );
}
