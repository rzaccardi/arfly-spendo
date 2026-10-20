import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { providerConnections } from '../../db/schema.js';
import { requireAuth } from '../auth-middleware.js';
import { accessibleTenantIds, resolveListTenantFilter } from '../../auth/context.js';
import {
  getSyncStatusForTenants,
  syncProviderConnection,
} from '../../domain/sync.js';
import { writeAuditLog } from '../../lib/audit.js';
import { badRequest, forbidden, tooManyRequests } from '../../lib/errors.js';

const SYNC_REQUEST_COOLDOWN_MS = 5 * 60 * 1000;

export async function syncRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get(
    '/v1/sync/status',
    {
      schema: {
        tags: ['Sync'],
        summary: 'Sync status and data freshness for accessible tenants',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const query = z
        .object({ tenant_id: z.string().uuid().optional() })
        .parse(request.query);
      const tenantId = resolveListTenantFilter(auth, 'accounts:read', query.tenant_id);
      const data = await getSyncStatusForTenants(db, [tenantId]);
      return { data };
    },
  );

  app.post(
    '/v1/sync/request',
    {
      schema: {
        tags: ['Sync'],
        summary: 'Request an on-demand sync for a tenant connection',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const auth = requireAuth(request);
      const body = z
        .object({
          tenant_id: z.string().uuid().optional(),
          provider_connection_id: z.string().uuid().optional(),
          request_provider_sync: z.boolean().optional().default(false),
        })
        .parse(request.body ?? {});

      const syncTenants = accessibleTenantIds(auth, 'sync:request');
      if (syncTenants.length === 0) {
        throw forbidden('Missing sync:request permission');
      }

      const tenantId = resolveListTenantFilter(auth, 'sync:request', body.tenant_id);

      const connectionFilters = [
        eq(providerConnections.tenantId, tenantId),
        eq(providerConnections.status, 'active'),
      ];
      if (body.provider_connection_id) {
        connectionFilters.push(eq(providerConnections.id, body.provider_connection_id));
      }
      const connections = await db
        .select()
        .from(providerConnections)
        .where(and(...connectionFilters));

      if (connections.length === 0) {
        throw badRequest('No active provider connection for tenant');
      }

      const now = Date.now();
      for (const c of connections) {
        if (
          c.lastSyncAttemptAt &&
          now - c.lastSyncAttemptAt.getTime() < SYNC_REQUEST_COOLDOWN_MS
        ) {
          throw tooManyRequests(
            'Sync requested too recently; wait before requesting again (cooldown 5m)',
          );
        }
      }

      const results = [];
      for (const c of connections) {
        results.push(
          await syncProviderConnection(db, c.id, {
            requestProviderSync: body.request_provider_sync,
          }),
        );
      }

      await writeAuditLog(db, {
        applicationId: auth.applicationId,
        tenantId,
        action: 'sync.request',
        resource: 'sync',
        metadata: { connections: results.map((r) => r.connectionId) },
      });

      return { data: results };
    },
  );
}
