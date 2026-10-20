import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  applicationCredentials,
  applications,
  applicationTenantPermissions,
} from '../db/schema.js';
import {
  extractBearerToken,
  keyPrefixFromRaw,
  verifyApiKey,
} from '../auth/api-keys.js';
import type { AuthContext } from '../auth/context.js';
import { unauthorized } from '../lib/errors.js';
import { writeAuditLog } from '../lib/audit.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function createAuthMiddleware(db: Db) {
  return async function authMiddleware(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const token = extractBearerToken(request.headers.authorization);
    if (!token || !token.startsWith('spk_')) {
      throw unauthorized('Missing or invalid Bearer API key');
    }

    const prefix = keyPrefixFromRaw(token);
    const candidates = await db
      .select({
        credential: applicationCredentials,
        application: applications,
      })
      .from(applicationCredentials)
      .innerJoin(applications, eq(applications.id, applicationCredentials.applicationId))
      .where(
        and(
          eq(applicationCredentials.keyPrefix, prefix),
          eq(applicationCredentials.status, 'active'),
          eq(applications.status, 'active'),
        ),
      );

    let matched: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (candidate.credential.expiresAt && candidate.credential.expiresAt < new Date()) {
        continue;
      }
      const ok = await verifyApiKey(token, candidate.credential.keyHash);
      if (ok) {
        matched = candidate;
        break;
      }
    }

    if (!matched) {
      await writeAuditLog(db, {
        action: 'auth.failed',
        resource: 'api_key',
        metadata: { prefix, path: request.url },
      });
      throw unauthorized('Invalid API key');
    }

    const perms = await db
      .select()
      .from(applicationTenantPermissions)
      .where(eq(applicationTenantPermissions.applicationId, matched.application.id));

    request.auth = {
      applicationId: matched.application.id,
      applicationName: matched.application.name,
      credentialId: matched.credential.id,
      tenants: perms.map((p) => ({
        tenantId: p.tenantId,
        permissions: p.permissions ?? [],
      })),
    };

    await db
      .update(applicationCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(applicationCredentials.id, matched.credential.id));
  };
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw unauthorized();
  }
  return request.auth;
}

export async function loadPermissionsForApps(db: Db, applicationIds: string[]) {
  if (applicationIds.length === 0) return [];
  return db
    .select()
    .from(applicationTenantPermissions)
    .where(inArray(applicationTenantPermissions.applicationId, applicationIds));
}
