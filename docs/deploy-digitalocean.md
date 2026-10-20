# Deploy Spendo su DigitalOcean App Platform

Questa guida spiega come pubblicare Spendo (API Fastify + worker cron in-process + Admin UI) come **un solo container Docker** su [App Platform](https://docs.digitalocean.com/products/app-platform/), con Postgres gestito e HTTPS in ingresso.

Architettura: un service `api` costruisce API + `web/dist` e serve tutto sulla stessa origine (cookie di login admin `SameSite=Lax` / `Secure` in production). `workspaces.json` **non** è richiesto a runtime: le connessioni Fintable vivono nel database dopo il seed (o dopo creazione via Admin UI).

File rilevanti:

| File | Ruolo |
| --- | --- |
| [`.do/app.yaml`](../.do/app.yaml) | Spec App Platform |
| [`Dockerfile`](../Dockerfile) | Multi-stage: build API + SPA, CMD migrate → start |
| [`.dockerignore`](../.dockerignore) | Esclude `.env`, `config/workspaces.json`, test, ecc. |

---

## Prerequisiti

- Account DigitalOcean e [doctl](https://docs.digitalocean.com/reference/doctl/how-to/install/) autenticato (`doctl auth init`)
- Repo GitHub collegato all’account DO (lo spec punta a `rzaccardi/arfly-spendo` / branch `main` — aggiorna se usi un fork)
- Valori pronti (generali localmente, **non** committarli):
  - `ENCRYPTION_KEY` — `openssl rand -hex 32`
  - `ADMIN_PASSWORD` — password operatori Admin UI
  - `ADMIN_API_KEY` — opzionale, Bearer per `/admin/api`
  - `FINTABLE_API_TOKEN` — PAT Fintable (solo se usi sync live; altrimenti sync in dry-run)

---

## Opzione A — doctl + spec

1. Rivedi `.do/app.yaml` (regione `fra`, repo/branch, size `basic-xxs`).
2. Crea l’app:

```bash
doctl apps create --spec .do/app.yaml
```

3. Annota l’`APP_ID` dall’output. Imposta i secret (sostituisci i placeholder):

```bash
# Preferibile: Control Panel → App → Settings → App-Level / component Environment Variables
# Oppure aggiorna lo spec dopo aver impostato i secret dalla UI.
doctl apps list
doctl apps get <APP_ID>
```

I campi `type: SECRET` (`ENCRYPTION_KEY`, `FINTABLE_API_TOKEN`, `ADMIN_PASSWORD`, `ADMIN_API_KEY`) vanno valorizzati dalla UI DigitalOcean (Settings → Environment Variables → Encrypt). Non inserire valori reali nello YAML versionato.

4. Aggiornamenti successivi:

```bash
doctl apps update <APP_ID> --spec .do/app.yaml
```

5. Log e deploy:

```bash
doctl apps logs <APP_ID> --type run --follow
doctl apps create-deployment <APP_ID>
```

Al primo avvio il container esegue `node dist/db/migrate.js` e poi avvia API + scheduler sync/webhook.

---

## Opzione B — Control Panel (UI)

1. **Apps** → **Create App** → collega il repo GitHub.
2. Seleziona il branch; rileva il `Dockerfile` in root (oppure importa lo spec `.do/app.yaml` se disponibile nel wizard).
3. HTTP port: **8080**, health check path: **/health**.
4. Aggiungi database **PostgreSQL 16** (dev/prod a scelta) e collega `DATABASE_URL` al service, oppure usa il bind `${spendo-db.DATABASE_URL}` come nello spec.
5. Imposta le variabili (vedi sotto), marca come **Encrypted** i secret.
6. Crea l’app: App Platform fornisce HTTPS sull’URL `*.ondigitalocean.app`.

---

## Database

### Componente gestito nello spec

Lo YAML include:

```yaml
databases:
  - name: spendo-db
    engine: PG
    version: "16"
    production: true
```

e sul service:

```yaml
- key: DATABASE_URL
  value: ${spendo-db.DATABASE_URL}
```

### Database Managed esistente

1. Rimuovi (o commenta) il blocco `databases` nello spec, oppure usa `cluster_name` / `db_name` / `db_user` come nelle note dello YAML.
2. Imposta `DATABASE_URL` come **SECRET** con la connection string (preferisci URL **private** se l’app e il DB sono nella stessa VPC/region).
3. Assicurati che il firewall del DB permetta il traffico da App Platform.

Le migration partono automaticamente a ogni deploy (`CMD` del Dockerfile). Sono idempotenti (Drizzle).

---

## Variabili d’ambiente

| Variabile | Scope | Note |
| --- | --- | --- |
| `NODE_ENV` | production | Abilita SPA static + cookie `Secure` |
| `HOST` | `0.0.0.0` | Bind in container |
| `PORT` | `8080` | Allineato a `http_port` (DO può anche iniettare `PORT`) |
| `DATABASE_URL` | bind o secret | Postgres |
| `ENCRYPTION_KEY` | **secret** | AES-256-GCM (PAT + webhook secrets) |
| `FINTABLE_API_TOKEN` | **secret** | Opzionale ma necessario per sync live |
| `ADMIN_PASSWORD` | **secret** | Login cookie Admin UI |
| `ADMIN_API_KEY` | **secret** | Opzionale Bearer admin |
| `SYNC_CRON` | default `*/15 * * * *` | Sync Fintable |
| `WEBHOOK_DELIVERY_CRON` | default `* * * * *` | Delivery outbound |
| `FINTABLE_BASE_URL` | default API v2 | |
| `FINTABLE_DRY_RUN` | `false` in prod tipico | Se manca il token, il codice forza dry-run |

Non impostare `VITE_API_BASE_URL`: l’admin usa path relativi (`/admin/api/...`) sulla stessa origine.

---

## Dominio custom

1. App → **Settings** → **Domains** → aggiungi il dominio (es. `spendo.tuodominio.com`).
2. Crea il record DNS indicato (CNAME verso `*.ondigitalocean.app` o come da UI).
3. Attendi il certificato TLS gestito da DigitalOcean.
4. L’Admin UI sarà su `https://tuodominio/` e l’API su `https://tuodominio/v1`, `/docs`, `/health`.

---

## Post-deploy: migrate e seed

- **Migrate**: automatiche a ogni avvio del container. Verifica nei log `Migrations applied successfully.`
- **Seed**: **una sola volta**, manualmente, e solo se serve creare tenant/app History (o simili). Il seed **non** è nel `CMD` di produzione.

Esempio (console one-off / macchina con accesso al DB e allo stesso `ENCRYPTION_KEY`):

```bash
# In locale, puntando al DATABASE_URL di produzione (tunnel/VPN/private):
export DATABASE_URL='postgresql://…'
export ENCRYPTION_KEY='…'   # stesso della prod
# History-only — non seedare placeholder Azienda 1–4 in produzione
cp config/workspaces.json.example config/workspaces.json
# modifica workspace_id / nomi History, poi:
npm run migrate   # se non già applicate
npm run seed
```

Salva le `spk_…` stampate **una volta**. Per connessioni successive preferisci Admin UI → Connessioni (i PAT restano cifrati in DB). Non copiare `workspaces.json` nell’immagine Docker.

In alternativa, crea tenant/app/chiavi via Admin UI / `npm run bootstrap` senza rieseguire il seed multi-tenant di demo.

---

## Checklist sicurezza

- [ ] Nessun secret in Git / nello YAML versionato / nell’immagine
- [ ] `ENCRYPTION_KEY` e `ADMIN_PASSWORD` forti e unici per ambiente
- [ ] `FINTABLE_API_TOKEN` solo come secret DO; PAT non in `workspaces.json` nel container
- [ ] Seed eseguito una volta; chiavi `spk_` archiviate fuori dal repo
- [ ] DB raggiungibile preferibilmente in rete privata; accesso pubblico ristretto
- [ ] Health check `/health` verde; HTTPS attivo (default App Platform)
- [ ] Rate limit e auth `/v1` (Bearer `spk_`) e `/admin/api` (password/cookie o `ADMIN_API_KEY`) verificati
- [ ] Log senza dump di PAT o API key
- [ ] Backup Postgres (managed backups DO) abilitati in produzione

---

## Verifica rapida

```bash
curl -sS https://<tuo-app>.ondigitalocean.app/health
# → {"status":"ok","service":"Spendo","company":"arfly"}

# Admin UI nel browser: https://<tuo-app>.ondigitalocean.app/
# OpenAPI: https://<tuo-app>.ondigitalocean.app/docs
```

---

## Troubleshooting

| Sintomo | Cosa controllare |
| --- | --- |
| Crash loop all’avvio | Log migrate: `DATABASE_URL`, rete verso Postgres |
| `Invalid configuration` | `ENCRYPTION_KEY` mancante o troppo corto |
| Admin login fallisce | `ADMIN_PASSWORD`, `NODE_ENV=production`, cookie su HTTPS |
| Sync non chiama Fintable | `FINTABLE_API_TOKEN` e `FINTABLE_DRY_RUN=false`; connessioni attive in DB |
| SPA 404 su route React | Conferma `web/dist` nell’immagine e `NODE_ENV=production` |

Per stack solo locale: `docker compose up -d` (Postgres) + `npm run build:all && NODE_ENV=production npm start` — vedi README.
