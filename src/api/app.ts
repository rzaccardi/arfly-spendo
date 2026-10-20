import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/client.js';
import type { AppConfig } from '../lib/config.js';
import { errorHandler } from './error-handler.js';
import { createAuthMiddleware } from './auth-middleware.js';
import { healthRoutes } from './routes/health.js';
import { tenantRoutes } from './routes/tenants.js';
import { accountRoutes } from './routes/accounts.js';
import { transactionRoutes } from './routes/transactions.js';
import { summaryRoutes } from './routes/summary.js';
import { syncRoutes } from './routes/sync.js';
import { adminRoutes } from './routes/admin.js';

export type BuildAppOptions = {
  db: Db;
  config: AppConfig;
  logger?: boolean | object;
};

/** Paths reserved for the API — SPA fallback must not claim these. */
function isApiOrDocsPath(urlPath: string): boolean {
  return (
    urlPath === '/health' ||
    urlPath.startsWith('/health/') ||
    urlPath.startsWith('/v1') ||
    urlPath.startsWith('/admin/api') ||
    urlPath.startsWith('/docs')
  );
}

function looksLikeStaticAsset(urlPath: string): boolean {
  return /\.[a-zA-Z0-9]+$/.test(urlPath);
}

export async function buildApp(opts: BuildAppOptions) {
  const app = Fastify({
    trustProxy: true,
    logger: opts.logger ?? {
      level: opts.config.LOG_LEVEL,
    },
  });

  app.setErrorHandler(errorHandler);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Spendo API',
        description:
          'Spendo Banking Hub by arfly — private Banking-as-a-Service for arfly SaaS apps. Provider-agnostic /v1 surface backed by Fintable in MVP.',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${opts.config.PORT}` }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'Spendo application API key (spk_...)',
          },
        },
      },
      tags: [
        { name: 'System' },
        { name: 'Tenants' },
        { name: 'Accounts' },
        { name: 'Transactions' },
        { name: 'Summary' },
        { name: 'Sync' },
        { name: 'Admin' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  await app.register(rateLimit, {
    max: opts.config.API_RATE_LIMIT_MAX,
    timeWindow: opts.config.API_RATE_LIMIT_TIME_WINDOW_MS,
    keyGenerator: (request) => {
      const auth = request.headers.authorization ?? request.ip;
      return String(auth);
    },
  });

  await healthRoutes(app);

  // Operator admin API (cookie session or ADMIN_API_KEY bearer) — separate from SaaS /v1 keys
  await adminRoutes(app, opts.db, opts.config);

  const authMiddleware = createAuthMiddleware(opts.db);
  await app.register(async (scoped) => {
    scoped.addHook('preHandler', authMiddleware);
    await tenantRoutes(scoped, opts.db);
    await accountRoutes(scoped, opts.db);
    await transactionRoutes(scoped, opts.db);
    await summaryRoutes(scoped, opts.db);
    await syncRoutes(scoped, opts.db);
  });

  // Production: serve Vite admin UI from web/dist (same origin as /admin/api cookies)
  if (opts.config.NODE_ENV === 'production') {
    const webDist = path.resolve(process.cwd(), 'web/dist');
    if (existsSync(webDist)) {
      await app.register(fastifyStatic, {
        root: webDist,
        prefix: '/',
        wildcard: false,
      });

      app.setNotFoundHandler((request, reply) => {
        const urlPath = (request.url.split('?')[0] ?? request.url) || '/';
        if (
          request.method === 'GET' &&
          !isApiOrDocsPath(urlPath) &&
          !looksLikeStaticAsset(urlPath)
        ) {
          return reply.sendFile('index.html');
        }
        return reply.status(404).send({
          error: {
            code: 'not_found',
            message: 'Not Found',
          },
        });
      });
    }
  }

  return app;
}
