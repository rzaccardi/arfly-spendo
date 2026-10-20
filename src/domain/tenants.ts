import { asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { notFound } from '../lib/errors.js';

export async function listTenants(db: Db, tenantIds: string[]) {
  if (tenantIds.length === 0) return [];
  const rows = await db
    .select()
    .from(tenants)
    .where(inArray(tenants.id, tenantIds))
    .orderBy(asc(tenants.name));
  return rows.map(serializeTenant);
}

export async function getTenant(db: Db, tenantId: string, allowedIds: string[]) {
  if (!allowedIds.includes(tenantId)) {
    throw notFound('Tenant not found');
  }
  const row = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!row) throw notFound('Tenant not found');
  return serializeTenant(row);
}

function serializeTenant(row: typeof tenants.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    legal_name: row.legalName,
    vat_number: row.vatNumber,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
