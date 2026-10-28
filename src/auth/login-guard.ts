import type { AppConfig } from '../lib/config.js';
import { tooManyRequests, unauthorized } from '../lib/errors.js';

type AttemptBucket = {
  failures: number;
  windowStartedAt: number;
  lockedUntil: number;
};

/**
 * In-memory progressive lockout for admin password login.
 * Single-process friendly (typical App Platform / local). Multi-instance
 * deployments may need a shared store later.
 */
const buckets = new Map<string, AttemptBucket>();

function bucketKey(ip: string): string {
  return `admin-login:${ip || 'unknown'}`;
}

function prune(now: number): void {
  if (buckets.size < 500) return;
  for (const [key, b] of buckets) {
    if (b.lockedUntil < now && now - b.windowStartedAt > 60 * 60_000) {
      buckets.delete(key);
    }
  }
}

export function assertAdminLoginAllowed(config: AppConfig, ip: string): void {
  const now = Date.now();
  prune(now);
  const key = bucketKey(ip);
  const bucket = buckets.get(key);
  if (!bucket) return;
  if (bucket.lockedUntil > now) {
    const retryAfterSec = Math.ceil((bucket.lockedUntil - now) / 1000);
    throw tooManyRequests(
      `Troppi tentativi di login. Riprova tra ${retryAfterSec} secondi.`,
      { retry_after_seconds: retryAfterSec },
    );
  }
}

export function recordAdminLoginFailure(config: AppConfig, ip: string): {
  failures: number;
  locked: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const key = bucketKey(ip);
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStartedAt > config.ADMIN_LOGIN_WINDOW_MS) {
    bucket = { failures: 0, windowStartedAt: now, lockedUntil: 0 };
  }
  bucket.failures += 1;
  let locked = false;
  let retryAfterSeconds = 0;
  if (bucket.failures >= config.ADMIN_LOGIN_MAX_ATTEMPTS) {
    bucket.lockedUntil = now + config.ADMIN_LOGIN_LOCKOUT_MS;
    locked = true;
    retryAfterSeconds = Math.ceil(config.ADMIN_LOGIN_LOCKOUT_MS / 1000);
    bucket.failures = 0;
    bucket.windowStartedAt = now;
  }
  buckets.set(key, bucket);
  return { failures: bucket.failures, locked, retryAfterSeconds };
}

export function clearAdminLoginFailures(ip: string): void {
  buckets.delete(bucketKey(ip));
}

/** Progressive delay after failed password attempts (ms). */
export function loginFailureDelayMs(failuresInWindow: number): number {
  return Math.min(2000, Math.max(0, failuresInWindow) * 200);
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function throwInvalidCredentials(opts?: {
  locked?: boolean;
  retryAfterSeconds?: number;
}): never {
  if (opts?.locked && opts.retryAfterSeconds) {
    throw tooManyRequests(
      `Troppi tentativi di login. Riprova tra ${opts.retryAfterSeconds} secondi.`,
      { retry_after_seconds: opts.retryAfterSeconds },
    );
  }
  throw unauthorized('Invalid admin credentials');
}

/** Test helper */
export function resetLoginGuardForTests(): void {
  buckets.clear();
}
