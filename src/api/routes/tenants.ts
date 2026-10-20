import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { requireAuth } from '../auth-middleware.js';
import { accessibleTenantIds } from '../../auth/context.js';
import { getTenant, listTenants } from '../../domain/tenants.js';
import { writeAuditLog } from '../../lib/audit.js';

export async function tenantRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get(
    '/v1/tenants',
    {
      schema: {
        tags: ['Tenants'],
        summary: 'List tenants accessible to the calling application',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const ids = accessibleTenantIds(auth, 'accounts:read');
      const data = await listTenants(db, ids.length ? ids : accessibleTenantIds(auth));
      await writeAuditLog(db, {
        applicationId: auth.applicationId,
        action: 'tenants.list',
        resource: 'tenant',
        metadata: { count: data.length },
      });
      return { data };
    },
  );

  app.get(
    '/v1/tenants/:id',
    {
      schema: {
        tags: ['Tenants'],
        summary: 'Get a tenant by id',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const allowed = accessibleTenantIds(auth);
      const data = await getTenant(db, id, allowed);
      await writeAuditLog(db, {
        applicationId: auth.applicationId,
        tenantId: id,
        action: 'tenants.get',
        resource: 'tenant',
        resourceId: id,
      });
      return { data };
    },
  );
}
