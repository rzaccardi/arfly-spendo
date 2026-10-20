import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';

const KEY_PREFIX_VISIBLE = 12;

export function generateApiKey(): { rawKey: string; prefix: string } {
  const secret = randomBytes(24).toString('base64url');
  const rawKey = `spk_${secret}`;
  const prefix = rawKey.slice(0, KEY_PREFIX_VISIBLE);
  return { rawKey, prefix };
}

export async function hashApiKey(rawKey: string): Promise<string> {
  return argon2.hash(rawKey, { type: argon2.argon2id });
}

export async function verifyApiKey(rawKey: string, keyHash: string): Promise<boolean> {
  try {
    return await argon2.verify(keyHash, rawKey);
  } catch {
    return false;
  }
}

export function extractBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(/\s+/, 2);
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return token.trim();
}

export function keyPrefixFromRaw(rawKey: string): string {
  return rawKey.slice(0, KEY_PREFIX_VISIBLE);
}
