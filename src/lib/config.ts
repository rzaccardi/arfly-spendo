import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .default('postgresql://spendo:spendo@localhost:5432/spendo'),
  ENCRYPTION_KEY: z.string().min(32),
  FINTABLE_API_TOKEN: z.string().optional().default(''),
  FINTABLE_BASE_URL: z.string().url().default('https://fintable.io/api/v2'),
  FINTABLE_DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),
  SYNC_CRON: z.string().default('*/15 * * * *'),
  /** Outbound webhook delivery worker (default: every minute) */
  WEBHOOK_DELIVERY_CRON: z.string().default('* * * * *'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  API_RATE_LIMIT_TIME_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  NODE_ENV: z.string().optional().default('development'),
  /** Admin UI /admin/api — password for cookie login */
  ADMIN_PASSWORD: z.string().optional().default(''),
  /** Admin bearer token (alias ADMIN_TOKEN also accepted via env merge) */
  ADMIN_API_KEY: z.string().optional().default(''),
  ADMIN_TOKEN: z.string().optional().default(''),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  /** Max failed admin password attempts per IP within the window before lockout */
  ADMIN_LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  /** Sliding window for counting failed logins (ms) */
  ADMIN_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60_000),
  /** Lockout duration after max attempts (ms) */
  ADMIN_LOGIN_LOCKOUT_MS: z.coerce.number().int().positive().default(15 * 60_000),
  /** Fastify route rate limit for POST /admin/api/login */
  ADMIN_LOGIN_RATE_MAX: z.coerce.number().int().positive().default(20),
  ADMIN_LOGIN_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** MFA challenge token TTL after password step */
  ADMIN_MFA_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
});

export type AppConfig = z.infer<typeof envSchema> & {
  fintableDryRun: boolean;
  hasFintableToken: boolean;
  adminApiKey: string;
  hasAdminAuth: boolean;
};

let cached: AppConfig | null = null;

export function loadConfig(overrides: Partial<Record<string, string>> = {}): AppConfig {
  const merged = { ...process.env, ...overrides };
  const parsed = envSchema.safeParse(merged);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const data = parsed.data;
  const fintableDryRun = Boolean(data.FINTABLE_DRY_RUN) || !data.FINTABLE_API_TOKEN;
  const adminApiKey = data.ADMIN_API_KEY || data.ADMIN_TOKEN || '';
  const config: AppConfig = {
    ...data,
    fintableDryRun,
    hasFintableToken: Boolean(data.FINTABLE_API_TOKEN),
    adminApiKey,
    hasAdminAuth: Boolean(data.ADMIN_PASSWORD || adminApiKey),
  };
  cached = config;
  return config;
}

export function getConfig(): AppConfig {
  if (!cached) {
    return loadConfig();
  }
  return cached;
}

/** Test helper to reset cached config */
export function resetConfigCache(): void {
  cached = null;
}
