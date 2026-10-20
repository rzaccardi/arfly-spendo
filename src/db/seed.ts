import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import {
  applications,
  applicationCredentials,
  applicationTenantPermissions,
  providerConnections,
  tenants,
} from './schema.js';
import { generateApiKey, hashApiKey } from '../auth/api-keys.js';
import { encryptSecret } from '../lib/crypto.js';
import { ALL_PERMISSIONS } from '../auth/permissions.js';
import { loadConfig } from '../lib/config.js';

type WorkspaceConfig = {
  tenants: Array<{
    name: string;
    legal_name?: string;
    vat_number?: string;
    workspace_id?: string;
  }>;
  applications: Array<{
    name: string;
    tenant_names: string[];
    permissions?: string[];
  }>;
};

function loadWorkspaceConfig(): WorkspaceConfig {
  const preferred = path.resolve(process.cwd(), 'config/workspaces.json');
  const example = path.resolve(process.cwd(), 'config/workspaces.json.example');

  if (existsSync(preferred)) {
    console.log(`Using seed config: ${preferred}`);
    return JSON.parse(readFileSync(preferred, 'utf8')) as WorkspaceConfig;
  }

  if (existsSync(example)) {
    console.warn(
      [
        '',
        'WARNING: config/workspaces.json not found — falling back to workspaces.json.example.',
        'The example is History-only with a REPLACE_ME workspace_id. Copy it to workspaces.json,',
        'set the real Fintable workspace ID, then re-run `npm run seed`.',
        'Do not seed multi-azienda placeholders against a live History database.',
        '',
      ].join('\n'),
    );
    console.log(`Using seed config: ${example}`);
    return JSON.parse(readFileSync(example, 'utf8')) as WorkspaceConfig;
  }

  throw new Error('No config/workspaces.json(.example) found');
}

async function main(): Promise<void> {
  const config = loadConfig();
  const workspaceConfig = loadWorkspaceConfig();
  const { db, sql } = createDb(config.DATABASE_URL);

  try {
    const tenantByName = new Map<string, string>();
    const printedKeys: Array<{ app: string; key: string }> = [];

    for (const t of workspaceConfig.tenants) {
      const existing = await db.query.tenants.findFirst({
        where: eq(tenants.name, t.name),
      });
      let tenantId: string;
      if (existing) {
        tenantId = existing.id;
        await db
          .update(tenants)
          .set({
            legalName: t.legal_name ?? existing.legalName,
            vatNumber: t.vat_number ?? existing.vatNumber,
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, existing.id));
      } else {
        const [created] = await db
          .insert(tenants)
          .values({
            name: t.name,
            legalName: t.legal_name ?? null,
            vatNumber: t.vat_number ?? null,
            status: 'active',
          })
          .returning();
        tenantId = created!.id;
      }
      tenantByName.set(t.name, tenantId);

      if (t.workspace_id && !t.workspace_id.includes('REPLACE_ME')) {
        const token = config.FINTABLE_API_TOKEN;
        if (!token) {
          console.warn(
            `Skipping provider_connection for ${t.name}: FINTABLE_API_TOKEN not set`,
          );
        } else {
          const encrypted = encryptSecret(token, config.ENCRYPTION_KEY);
          const existingConn = await db.query.providerConnections.findFirst({
            where: eq(providerConnections.workspaceId, t.workspace_id),
          });
          if (existingConn) {
            await db
              .update(providerConnections)
              .set({
                encryptedCredentials: encrypted,
                tenantId,
                status: 'active',
                updatedAt: new Date(),
              })
              .where(eq(providerConnections.id, existingConn.id));
          } else {
            await db.insert(providerConnections).values({
              tenantId,
              provider: 'fintable',
              workspaceId: t.workspace_id,
              encryptedCredentials: encrypted,
              status: 'active',
            });
          }
          console.log(`Linked ${t.name} → workspace ${t.workspace_id}`);
        }
      } else {
        console.log(
          `Tenant ${t.name} created without provider_connection (set workspace_id in config/workspaces.json)`,
        );
      }
    }

    for (const appDef of workspaceConfig.applications) {
      let app = await db.query.applications.findFirst({
        where: eq(applications.name, appDef.name),
      });
      if (!app) {
        const [created] = await db
          .insert(applications)
          .values({ name: appDef.name, status: 'active' })
          .returning();
        app = created!;
      }

      const permissions = appDef.permissions?.length
        ? appDef.permissions
        : [...ALL_PERMISSIONS];

      for (const tenantName of appDef.tenant_names) {
        const tenantId = tenantByName.get(tenantName);
        if (!tenantId) {
          console.warn(`Unknown tenant name in app ${appDef.name}: ${tenantName}`);
          continue;
        }
        await db
          .insert(applicationTenantPermissions)
          .values({
            applicationId: app.id,
            tenantId,
            permissions,
          })
          .onConflictDoUpdate({
            target: [
              applicationTenantPermissions.applicationId,
              applicationTenantPermissions.tenantId,
            ],
            set: { permissions },
          });
      }

      const existingCreds = await db.query.applicationCredentials.findFirst({
        where: eq(applicationCredentials.applicationId, app.id),
      });
      if (!existingCreds) {
        const { rawKey, prefix } = generateApiKey();
        const keyHash = await hashApiKey(rawKey);
        await db.insert(applicationCredentials).values({
          applicationId: app.id,
          keyPrefix: prefix,
          keyHash,
          status: 'active',
        });
        printedKeys.push({ app: appDef.name, key: rawKey });
      }
    }

    console.log('\n=== Seed complete ===');
    if (printedKeys.length) {
      console.log('\nAPI keys (shown once — store them securely):\n');
      for (const k of printedKeys) {
        console.log(`  ${k.app}: ${k.key}`);
      }
    } else {
      console.log('No new API keys generated (credentials already existed).');
      console.log('Use `npm run bootstrap -- rotate-key --app "App Name"` to mint a new key.');
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
