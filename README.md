# Spendo by arfly

**Spendo** is arfly’s private Banking-as-a-Service hub. It syncs bank data from [Fintable](https://fintable.io) workspaces into a multi-tenant Postgres store and exposes a provider-agnostic REST API (`/v1`) that arfly SaaS apps consume with Spendo API keys (`spk_…`).

Live example: **History** SaaS → tenant History → one Fintable workspace (see `config/workspaces.json`).

## Product story

```
┌─────────────┐     spk_ API      ┌──────────────────┐     PAT (encrypted)
│  SaaS apps  │ ───────────────► │  Spendo Banking  │ ──────────────────► Fintable
│ (History,…) │ ◄── webhooks ─── │  Hub (/v1 + admin)│ ◄── sync cron ──── workspaces
└─────────────┘                  └────────┬─────────┘
                                          │
                                   PostgreSQL
```

1. **Operators** use the Admin UI / `/admin/api` to manage tenants, apps, Fintable connections, sync, cash-flow views, and webhook subscriptions.
2. **SaaS apps** never see Fintable PATs. They call `/v1` with a Spendo key scoped to permitted tenants.
3. **Sync worker** pulls accounts, balances, and transactions; emits outbound webhooks best-effort.

## Stack

- Node.js 20+ · TypeScript (strict)
- Fastify + Zod + OpenAPI (`/docs`)
- PostgreSQL 16 (Docker Compose)
- Drizzle ORM + migrations
- In-process `node-cron` for sync + webhook delivery
- AES-256-GCM for secrets at rest · argon2 for API key hashing
- React (Vite) admin UI under `web/`

## Quick start

```bash
# 1. Environment
cp .env.example .env
# Set ENCRYPTION_KEY (openssl rand -hex 32), ADMIN_PASSWORD, optionally FINTABLE_API_TOKEN

# 2. Workspaces — History-only template (do not seed Azienda 1–4 placeholders in prod)
cp config/workspaces.json.example config/workspaces.json
# Edit with real Fintable workspace IDs (History example in the file comments / example)

# 3. Database
docker compose up -d
npm install
npm run migrate
npm run seed

# 4. API + schedulers + Admin UI
cd web && npm install && cd ..
npm run dev:all
```

| Surface | URL |
| --- | --- |
| Health | http://localhost:3000/health |
| OpenAPI | http://localhost:3000/docs |
| Admin UI | http://localhost:5173 |
| One-shot sync | `npm run worker` |

Seed prints API keys **once**. Store them securely.

### Production-ish local mode

```bash
docker compose up -d          # Postgres only (default)
npm run migrate
npm run build && npm run web:build
NODE_ENV=production npm start # API + cron workers + Admin SPA from web/dist (same origin)
```

Optional Compose notes: only `postgres` is defined by default. For DigitalOcean App Platform, use the `Dockerfile` / `.do/app.yaml` — [docs/deploy-digitalocean.md](docs/deploy-digitalocean.md). Do not commit real PATs or `spk_` keys.

## Admin UI (operator console)

Credentials are separate from SaaS `spk_` keys:

- `ADMIN_PASSWORD` — cookie session (`spendo_admin_session`)
- and/or `ADMIN_API_KEY` / `ADMIN_TOKEN` — Bearer on `/admin/api/*`

| Page | Purpose |
| --- | --- |
| Panoramica | Counts + sync last 24h |
| Tenant | CRUD + connection status |
| Applicazioni | Create app, permissions, rotate/revoke key |
| Connessioni | Fintable workspace links + sync/deactivate |
| Sync job | Recent jobs + manual trigger |
| Flusso di cassa | Inflows/outflows by period per currency |
| Webhook | Subscriptions + deliveries + queue flush |
| Audit log | Paginated filters (no secrets) |
| Conti & movimenti | Browse + CSV export |

## History example

`config/workspaces.json` (gitignored if secrets present — prefer local only) should look like:

```json
{
  "tenants": [{ "name": "History", "workspace_id": "ws_…" }],
  "applications": [{
    "name": "History SaaS",
    "tenant_names": ["History"],
    "permissions": ["accounts:read", "balances:read", "transactions:read", "sync:request"]
  }]
}
```

Copy from `config/workspaces.json.example`. Seed **prefers** `workspaces.json`; falling back to a multi-azienda example is for greenfield demos only — production History installs should keep a History-only file.

## Deploy (DigitalOcean)

Production-ready App Platform config (single Docker service: API + cron + admin SPA): see **[docs/deploy-digitalocean.md](docs/deploy-digitalocean.md)** (`.do/app.yaml`, `Dockerfile`).

## SaaS integration

See [docs/saas-integration.md](docs/saas-integration.md) and [docs/webhooks.md](docs/webhooks.md).

- Auth: `Authorization: Bearer spk_…`
- Permissions: `accounts:read`, `balances:read`, `transactions:read`, `sync:request`
- Multi-tenant apps must pass `tenant_id`
- Amounts are decimal **strings**; currencies are never summed together
- Cash flow: `GET /v1/cashflow?granularity=month|week|day`

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | API + cron sync + webhook worker (tsx watch) |
| `npm run web` | Vite React admin UI |
| `npm run dev:all` | API + admin UI together |
| `npm run build` / `start` | Compile and run `dist/` (`NODE_ENV=production` also serves Admin SPA) |
| `npm run start:prod` | Migrate then start (Docker / App Platform CMD) |
| `npm run web:build` | Build admin UI to `web/dist` |
| `npm run migrate` | Apply Drizzle migrations |
| `npm run seed` | Seed tenants/apps/keys (+ connections if configured) |
| `npm run bootstrap` | Admin CLI |
| `npm run worker` | One-shot sync all active connections |
| `npm test` | Vitest |

## Project layout

```
src/
  api/           # /v1 + /admin/api routes, auth, OpenAPI
  auth/          # API keys, admin session, permissions
  domain/        # tenants, accounts, transactions, sync, summary, webhooks
  providers/     # BankingProvider + Fintable adapter
  workers/       # scheduled sync + webhook delivery
  db/            # Drizzle schema + migrations
  lib/           # crypto, pagination, errors, audit, config
  cli/           # bootstrap
web/             # React admin UI (Vite)
docs/
tests/
config/          # workspaces.json (History-only in live installs)
```

## Status

Shipped: multi-tenant sync (Fintable), `/v1` API, admin UI, CSV export, transaction search, outbound webhooks with retry worker, cash-flow summary.

Deferred: invoice reconciliation, ML categorization, EnableBanking/Yapily, Kubernetes.

## License

Proprietary — arfly / Spendo.
