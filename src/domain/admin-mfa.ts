import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { adminMfaSettings } from '../db/schema.js';
import { hashApiKey, verifyApiKey } from '../auth/api-keys.js';
import {
  buildOtpAuthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  verifyTotpCode,
} from '../auth/totp.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import type { AppConfig } from '../lib/config.js';

const ROW_ID = 'default';

async function ensureRow(db: Db) {
  const existing = await db
    .select()
    .from(adminMfaSettings)
    .where(eq(adminMfaSettings.id, ROW_ID))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db
    .insert(adminMfaSettings)
    .values({
      id: ROW_ID,
      enabled: false,
      recoveryCodeHashes: [],
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const again = await db
    .select()
    .from(adminMfaSettings)
    .where(eq(adminMfaSettings.id, ROW_ID))
    .limit(1);
  return again[0]!;
}

export async function getAdminMfaStatus(db: Db) {
  const row = await ensureRow(db);
  return {
    enabled: row.enabled,
    setup_pending: Boolean(row.pendingEncryptedSecret),
    recovery_codes_remaining: (row.recoveryCodeHashes ?? []).length,
  };
}

export async function isAdminMfaEnabled(db: Db): Promise<boolean> {
  const row = await ensureRow(db);
  return row.enabled && Boolean(row.encryptedTotpSecret);
}

export async function startAdminMfaSetup(db: Db, config: AppConfig) {
  const row = await ensureRow(db);
  if (row.enabled) {
    throw badRequest('MFA is already enabled. Disable it before re-enrolling.');
  }
  const secret = generateTotpSecret();
  const encrypted = encryptSecret(secret, config.ENCRYPTION_KEY);
  await db
    .update(adminMfaSettings)
    .set({
      pendingEncryptedSecret: encrypted,
      updatedAt: new Date(),
    })
    .where(eq(adminMfaSettings.id, ROW_ID));

  const otpauthUrl = buildOtpAuthUri({
    secretBase32: secret,
    accountName: 'admin',
    issuer: 'Spendo',
  });
  return {
    secret,
    otpauth_url: otpauthUrl,
    issuer: 'Spendo',
    account: 'admin',
  };
}

export async function confirmAdminMfaSetup(
  db: Db,
  config: AppConfig,
  totpCode: string,
): Promise<{ recovery_codes: string[] }> {
  const row = await ensureRow(db);
  if (!row.pendingEncryptedSecret) {
    throw badRequest('No MFA setup in progress. Call setup first.');
  }
  const secret = decryptSecret(row.pendingEncryptedSecret, config.ENCRYPTION_KEY);
  if (!verifyTotpCode(secret, totpCode)) {
    throw unauthorized('Invalid authenticator code');
  }
  const recoveryCodes = generateRecoveryCodes(8);
  const hashes = await Promise.all(recoveryCodes.map((c) => hashApiKey(normalizeRecoveryCode(c))));
  await db
    .update(adminMfaSettings)
    .set({
      enabled: true,
      encryptedTotpSecret: row.pendingEncryptedSecret,
      pendingEncryptedSecret: null,
      recoveryCodeHashes: hashes,
      updatedAt: new Date(),
    })
    .where(eq(adminMfaSettings.id, ROW_ID));
  return { recovery_codes: recoveryCodes };
}

export async function disableAdminMfa(
  db: Db,
  config: AppConfig,
  opts: { totpCode?: string; recoveryCode?: string },
): Promise<void> {
  const row = await ensureRow(db);
  if (!row.enabled || !row.encryptedTotpSecret) {
    throw badRequest('MFA is not enabled');
  }
  const ok = await verifyAdminMfaFactor(db, config, opts);
  if (!ok) throw unauthorized('Invalid authenticator or recovery code');
  await db
    .update(adminMfaSettings)
    .set({
      enabled: false,
      encryptedTotpSecret: null,
      pendingEncryptedSecret: null,
      recoveryCodeHashes: [],
      updatedAt: new Date(),
    })
    .where(eq(adminMfaSettings.id, ROW_ID));
}

export async function regenerateAdminRecoveryCodes(
  db: Db,
  config: AppConfig,
  totpCode: string,
): Promise<{ recovery_codes: string[] }> {
  const row = await ensureRow(db);
  if (!row.enabled || !row.encryptedTotpSecret) {
    throw badRequest('MFA is not enabled');
  }
  const secret = decryptSecret(row.encryptedTotpSecret, config.ENCRYPTION_KEY);
  if (!verifyTotpCode(secret, totpCode)) {
    throw unauthorized('Invalid authenticator code');
  }
  const recoveryCodes = generateRecoveryCodes(8);
  const hashes = await Promise.all(recoveryCodes.map((c) => hashApiKey(normalizeRecoveryCode(c))));
  await db
    .update(adminMfaSettings)
    .set({
      recoveryCodeHashes: hashes,
      updatedAt: new Date(),
    })
    .where(eq(adminMfaSettings.id, ROW_ID));
  return { recovery_codes: recoveryCodes };
}

export async function verifyAdminMfaFactor(
  db: Db,
  config: AppConfig,
  opts: { totpCode?: string; recoveryCode?: string },
): Promise<boolean> {
  const row = await ensureRow(db);
  if (!row.enabled || !row.encryptedTotpSecret) return true;

  if (opts.totpCode) {
    const secret = decryptSecret(row.encryptedTotpSecret, config.ENCRYPTION_KEY);
    return verifyTotpCode(secret, opts.totpCode);
  }

  if (opts.recoveryCode) {
    const normalized = normalizeRecoveryCode(opts.recoveryCode);
    const hashes = [...(row.recoveryCodeHashes ?? [])];
    for (let i = 0; i < hashes.length; i++) {
      const match = await verifyApiKey(normalized, hashes[i]!);
      if (match) {
        hashes.splice(i, 1);
        await db
          .update(adminMfaSettings)
          .set({
            recoveryCodeHashes: hashes,
            updatedAt: new Date(),
          })
          .where(eq(adminMfaSettings.id, ROW_ID));
        return true;
      }
    }
    return false;
  }

  return false;
}
