#!/usr/bin/env node
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb } from '../db/client.js';
import {
  applications,
  applicationCredentials,
  applicationTenantPermissions,
  providerConnections,
  tenants,
} from '../db/schema.js';
import { generateApiKey, hashApiKey } from '../auth/api-keys.js';
import { encryptSecret } from '../lib/crypto.js';
import { ALL_PERMISSIONS, isPermission } from '../auth/permissions.js';
import { loadConfig } from '../lib/config.js';

function usage(): never {
  console.log(`Spendo bootstrap CLI (arfly)

Usage:
  npm run bootstrap -- create-tenant --name "Azienda X" [--legal-name "..."] [--vat "..."]
  npm run bootstrap -- create-app --name "My SaaS" [--tenant-id UUID] [--permissions a,b,c]
  npm run bootstrap -- grant --app-id UUID --tenant-id UUID [--permissions a,b,c]
  npm run bootstrap -- rotate-key --app-id UUID
  npm run bootstrap -- register-fintable --tenant-id UUID --workspace-id ws_... [--token PAT]

Environment:
  DATABASE_URL, ENCRYPTION_KEY, FINTABLE_API_TOKEN (optional if --token provided)
`);
  process.exit(1);
}

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function parsePermissions(raw?: string): string[] {
  if (!raw) return [...ALL_PERMISSIONS];
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    if (!isPermission(p)) {
      throw new Error(`Unknown permission: ${p}`);
    }
  }
  return parts;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command) usage();

  const config = loadConfig();
  const { db, sql } = createDb(config.DATABASE_URL);

  try {
    switch (command) {
      case 'create-tenant': {
        const name = argValue(args, '--name');
        if (!name) usage();
        const [row] = await db
          .insert(tenants)
          .values({
            name: name!,
            legalName: argValue(args, '--legal-name') ?? null,
            vatNumber: argValue(args, '--vat') ?? null,
          })
          .returning();
        console.log(JSON.stringify(row, null, 2));
        break;
      }
      case 'create-app': {
        const name = argValue(args, '--name');
        if (!name) usage();
        const [app] = await db
          .insert(applications)
          .values({ name: name! })
          .returning();
        const tenantId = argValue(args, '--tenant-id');
        const permissions = parsePermissions(argValue(args, '--permissions'));
        if (tenantId) {
          await db.insert(applicationTenantPermissions).values({
            applicationId: app!.id,
            tenantId,
            permissions,
          });
        }
        const { rawKey, prefix } = generateApiKey();
        const keyHash = await hashApiKey(rawKey);
        await db.insert(applicationCredentials).values({
          applicationId: app!.id,
          keyPrefix: prefix,
          keyHash,
          status: 'active',
        });
        console.log(JSON.stringify({ application: app, api_key: rawKey }, null, 2));
        console.log('\nStore the api_key now — it will not be shown again.');
        break;
      }
      case 'grant': {
        const appId = argValue(args, '--app-id');
        const tenantId = argValue(args, '--tenant-id');
        if (!appId || !tenantId) usage();
        const permissions = parsePermissions(argValue(args, '--permissions'));
        const [row] = await db
          .insert(applicationTenantPermissions)
          .values({
            applicationId: appId!,
            tenantId: tenantId!,
            permissions,
          })
          .onConflictDoUpdate({
            target: [
              applicationTenantPermissions.applicationId,
              applicationTenantPermissions.tenantId,
            ],
            set: { permissions },
          })
          .returning();
        console.log(JSON.stringify(row, null, 2));
        break;
      }
      case 'rotate-key': {
        const appId =
          argValue(args, '--app-id') ??
          (await (async () => {
            const appName = argValue(args, '--app');
            if (!appName) return undefined;
            const app = await db.query.applications.findFirst({
              where: eq(applications.name, appName),
            });
            return app?.id;
          })());
        if (!appId) usage();
        await db
          .update(applicationCredentials)
          .set({ status: 'revoked' })
          .where(eq(applicationCredentials.applicationId, appId!));
        const { rawKey, prefix } = generateApiKey();
        const keyHash = await hashApiKey(rawKey);
        await db.insert(applicationCredentials).values({
          applicationId: appId!,
          keyPrefix: prefix,
          keyHash,
          status: 'active',
        });
        console.log(JSON.stringify({ application_id: appId, api_key: rawKey }, null, 2));
        console.log('\nStore the api_key now — it will not be shown again.');
        break;
      }
      case 'register-fintable': {
        const tenantId = argValue(args, '--tenant-id');
        const workspaceId = argValue(args, '--workspace-id');
        if (!tenantId || !workspaceId) usage();
        const token = argValue(args, '--token') || config.FINTABLE_API_TOKEN;
        if (!token) {
          throw new Error('Provide --token or set FINTABLE_API_TOKEN');
        }
        const encrypted = encryptSecret(token, config.ENCRYPTION_KEY);
        const [row] = await db
          .insert(providerConnections)
          .values({
            tenantId: tenantId!,
            provider: 'fintable',
            workspaceId: workspaceId!,
            encryptedCredentials: encrypted,
            status: 'active',
          })
          .onConflictDoUpdate({
            target: [providerConnections.provider, providerConnections.workspaceId],
            set: {
              tenantId: tenantId!,
              encryptedCredentials: encrypted,
              status: 'active',
              updatedAt: new Date(),
              lastError: null,
            },
          })
          .returning();
        console.log(
          JSON.stringify(
            {
              id: row!.id,
              tenant_id: row!.tenantId,
              workspace_id: row!.workspaceId,
              provider: row!.provider,
              status: row!.status,
            },
            null,
            2,
          ),
        );
        break;
      }
      default:
        usage();
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
