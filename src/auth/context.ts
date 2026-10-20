import type { Permission } from './permissions.js';

export type TenantAccess = {
  tenantId: string;
  permissions: string[];
};

export type AuthContext = {
  applicationId: string;
  applicationName: string;
  credentialId: string;
  tenants: TenantAccess[];
};

export function resolveTenantId(
  auth: AuthContext,
  required: Permission,
  requestedTenantId?: string | null,
): string {
  const allowed = auth.tenants.filter((t) => t.permissions.includes(required));
  if (allowed.length === 0) {
    throw Object.assign(new Error('Missing permission'), { code: 'forbidden', statusCode: 403 });
  }

  if (requestedTenantId) {
    const match = allowed.find((t) => t.tenantId === requestedTenantId);
    if (!match) {
      throw Object.assign(new Error('Tenant not permitted for this application'), {
        code: 'forbidden',
        statusCode: 403,
      });
    }
    return match.tenantId;
  }

  if (allowed.length === 1) {
    return allowed[0]!.tenantId;
  }

  throw Object.assign(
    new Error('tenant_id query parameter is required when the application has multiple tenants'),
    { code: 'bad_request', statusCode: 400 },
  );
}

/**
 * For list endpoints: single-tenant apps may omit tenant_id (returns that tenant).
 * Multi-tenant apps must pass tenant_id.
 * Returns the tenant id filter to apply (always a single id).
 */
export function resolveListTenantFilter(
  auth: AuthContext,
  required: Permission,
  requestedTenantId?: string | null,
): string {
  return resolveTenantId(auth, required, requestedTenantId);
}

export function assertTenantPermission(
  auth: AuthContext,
  tenantId: string,
  required: Permission,
): void {
  const match = auth.tenants.find((t) => t.tenantId === tenantId);
  if (!match || !match.permissions.includes(required)) {
    throw Object.assign(new Error('Forbidden'), { code: 'forbidden', statusCode: 403 });
  }
}

export function accessibleTenantIds(auth: AuthContext, required?: Permission): string[] {
  return auth.tenants
    .filter((t) => (required ? t.permissions.includes(required) : true))
    .map((t) => t.tenantId);
}
