import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../lib/config.js';
import { extractBearerToken } from './api-keys.js';

const COOKIE_NAME = 'spendo_admin_session';

export { COOKIE_NAME };

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyAdminPassword(config: AppConfig, password: string): boolean {
  if (!config.ADMIN_PASSWORD) return false;
  return safeEqual(password, config.ADMIN_PASSWORD);
}

export function verifyAdminApiKey(config: AppConfig, token: string): boolean {
  if (!config.adminApiKey) return false;
  return safeEqual(token, config.adminApiKey);
}

function sessionSecret(config: AppConfig): string {
  return `spendo-admin:${config.ENCRYPTION_KEY}:${config.ADMIN_PASSWORD || config.adminApiKey || 'none'}`;
}

export function createAdminSessionToken(config: AppConfig): string {
  const ttlMs = config.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000;
  const exp = Date.now() + ttlMs;
  const payload = Buffer.from(JSON.stringify({ exp, v: 1 }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', sessionSecret(config)).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyAdminSessionToken(config: AppConfig, token: string): boolean {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = createHmac('sha256', sessionSecret(config)).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (!data.exp || Date.now() > data.exp) return false;
    return true;
  } catch {
    return false;
  }
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function isAdminAuthenticated(
  config: AppConfig,
  headers: { authorization?: string; cookie?: string },
): boolean {
  if (!config.hasAdminAuth) return false;

  const bearer = extractBearerToken(headers.authorization);
  if (bearer && verifyAdminApiKey(config, bearer)) return true;

  const cookies = parseCookieHeader(headers.cookie);
  const session = cookies[COOKIE_NAME];
  if (session && verifyAdminSessionToken(config, session)) return true;

  return false;
}

export function adminSessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearAdminSessionCookie(secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
