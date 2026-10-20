import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { requireAuth } from '../auth-middleware.js';
import { resolveListTenantFilter } from '../../auth/context.js';
import { buildCashflow, buildSummary } from '../../domain/summary.js';
import { writeAuditLog } from '../../lib/audit.js';

const querySchema = z.object({
  tenant_id: z.string().uuid().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

const cashflowQuerySchema = querySchema.extend({
  granularity: z.enum(['day', 'week', 'month']).optional().default('month'),
});

export async function summaryRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get(
    '/v1/summary',
    {
      schema: {
        tags: ['Summary'],
        summary:
          'Balances per account and aggregates per currency (never sums different currencies)',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const query = querySchema.parse(request.query);
      const tenantId = resolveListTenantFilter(auth, 'balances:read', query.tenant_id);

      const data = await buildSummary(db, {
        tenantIds: [tenantId],
        tenantId,
        dateFrom: query.date_from,
        dateTo: query.date_to,
      });
      await writeAuditLog(db, {
        applicationId: auth.applicationId,
        tenantId,
        action: 'summary.get',
        resource: 'summary',
      });
      return { data };
    },
  );

  app.get(
    '/v1/cashflow',
    {
      schema: {
        tags: ['Summary'],
        summary:
          'Cash-flow series (inflows/outflows/net) by period, keyed by currency — never mixes currencies',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const query = cashflowQuerySchema.parse(request.query);
      const tenantId = resolveListTenantFilter(auth, 'balances:read', query.tenant_id);

      const data = await buildCashflow(db, {
        tenantIds: [tenantId],
        tenantId,
        dateFrom: query.date_from,
        dateTo: query.date_to,
        granularity: query.granularity,
      });
      await writeAuditLog(db, {
        applicationId: auth.applicationId,
        tenantId,
        action: 'cashflow.get',
        resource: 'cashflow',
      });
      return { data };
    },
  );
}
