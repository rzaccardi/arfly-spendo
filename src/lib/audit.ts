import type { Db } from '../db/client.js';
import { auditLogs } from '../db/schema.js';

const SENSITIVE_KEYS = new Set([
  'token',
  'pat',
  'password',
  'secret',
  'authorization',
  'api_key',
  'apikey',
  'encrypted_credentials',
  'key',
  'raw_data',
  'raw',
]);

function sanitizeMetadata(meta?: Record<string, unknown>): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) continue;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out[k] = sanitizeMetadata(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function writeAuditLog(
  db: Db,
  entry: {
    tenantId?: string | null;
    applicationId?: string | null;
    action: string;
    resource: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    tenantId: entry.tenantId ?? null,
    applicationId: entry.applicationId ?? null,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    metadata: sanitizeMetadata(entry.metadata),
  });
}
