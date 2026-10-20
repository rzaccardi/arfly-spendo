import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { requireAuth } from '../auth-middleware.js';
import { accessibleTenantIds, resolveListTenantFilter } from '../../auth/context.js';
import { getTransaction, listTransactions } from '../../domain/transactions.js';
import { transactionsToCsv } from '../../domain/admin.js';
import { writeAuditLog } from '../../lib/audit.js';
import { forbidden } from '../../lib/errors.js';

const querySchema = z.object({
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
  limit: z.coerce.number().int().positive().max(200).optional(),
  format: z.enum(['json', 'csv']).optional(),
});

export async function transactionRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get(
    '/v1/transactions',
    {
      schema: {
        tags: ['Transactions'],
        summary: 'List transactions with filters and cursor pagination',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const query = querySchema.parse(request.query);
      const tenantId = resolveListTenantFilter(auth, 'transactions:read', query.tenant_id);
      const result = await listTransactions(db, {
        tenantIds: [tenantId],
        tenantId,
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
      await writeAuditLog(db, {
        applicationId: auth.applicationId,
        tenantId,
        action: query.format === 'csv' ? 'transactions.export' : 'transactions.list',
        resource: 'transaction',
        metadata: { count: result.data.length, format: query.format ?? 'json' },
      });
      if (query.format === 'csv') {
        reply.header('content-type', 'text/csv; charset=utf-8');
        reply.header(
          'content-disposition',
          `attachment; filename="spendo-transactions-${tenantId.slice(0, 8)}.csv"`,
        );
        return transactionsToCsv(result.data);
      }
      return result;
    },
  );

  app.get(
    '/v1/transactions/export',
    {
      schema: {
        tags: ['Transactions'],
        summary: 'Export transactions as CSV (requires transactions:read)',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const auth = requireAuth(request);
      const tenantIds = accessibleTenantIds(auth, 'transactions:read');
      if (tenantIds.length === 0) throw forbidden('Missing transactions:read permission');
      const query = querySchema.parse(request.query);
      const tenantId = resolveListTenantFilter(auth, 'transactions:read', query.tenant_id);
      const result = await listTransactions(db, {
        tenantIds: [tenantId],
        tenantId,
        accountId: query.account_id,
        dateFrom: query.date_from,
        dateTo: query.date_to,
        type: query.type,
        status: query.status,
        minAmount: query.min_amount,
        maxAmount: query.max_amount,
        q: query.q,
        limit: 5000,
      });
      await writeAuditLog(db, {
        applicationId: auth.applicationId,
        tenantId,
        action: 'transactions.export',
        resource: 'transaction',
        metadata: { count: result.data.length },
      });
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header(
        'content-disposition',
        `attachment; filename="spendo-transactions-${tenantId.slice(0, 8)}.csv"`,
      );
      return transactionsToCsv(result.data);
    },
  );

  app.get(
    '/v1/transactions/:id',
    {
      schema: {
        tags: ['Transactions'],
        summary: 'Get transaction by id',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const tenantIds = accessibleTenantIds(auth, 'transactions:read');
      const data = await getTransaction(db, id, tenantIds);
      await writeAuditLog(db, {
        applicationId: auth.applicationId,
        tenantId: data.tenant_id,
        action: 'transactions.get',
        resource: 'transaction',
        resourceId: id,
      });
      return { data };
    },
  );
}
