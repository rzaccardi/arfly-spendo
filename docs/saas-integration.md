# Spendo — Guida integrazione SaaS (History)

Spendo è il Banking Hub interno di arfly. La SaaS (es. **History** su `manage.historyroma3z.it`) si autentica con una **API key Spendo**, mai con un PAT Fintable. Le credenziali provider restano cifrate in Spendo.

**Contratto completo `/v1` (endpoint, esempi JSON, errori, CSV, webhook):**  
→ [`docs/api-contract-v1.md`](./api-contract-v1.md)

OpenAPI UI (runtime): `/docs`

---

## Autenticazione

```http
Authorization: Bearer spk_<secret>
```

Chiavi emesse per **application** (`npm run seed`, `npm run bootstrap -- create-app`, o Admin UI). Solo il prefix è in chiaro a DB; il secret è argon2-hashed.

### Permessi

| Permesso | Endpoint |
| --- | --- |
| `accounts:read` | `GET /v1/tenants`, `GET /v1/accounts`, `GET /v1/accounts/:id`, `GET /v1/sync/status` |
| `balances:read` | `GET /v1/accounts/:id/balances`, `GET /v1/summary`, `GET /v1/cashflow` |
| `transactions:read` | `GET /v1/transactions`, `GET /v1/transactions/:id`, `GET /v1/transactions/export` |
| `sync:request` | `POST /v1/sync/request` |

### Risoluzione tenant

- Grant per tenant via `application_tenant_permissions`.
- **Mono-tenant:** omettere `tenant_id` — Spendo usa l’unico tenant con il permesso richiesto.
- **Multi-tenant:** passare `tenant_id` (UUID). Altrimenti `400`. Tenant non consentito → `403`.
- ID risorsa di altro tenant → `404` (no leak).

---

## Base URL

```
http://localhost:3000
```

In staging/produzione: URL fornito da arfly (stessi path).

---

## Endpoint (indice)

| Metodo | Path | Note |
| --- | --- | --- |
| `GET` | `/health` | No auth |
| `GET` | `/v1/tenants` | Lista tenant accessibili |
| `GET` | `/v1/tenants/:id` | Dettaglio |
| `GET` | `/v1/accounts` | Query: `tenant_id`, `currency`, `status` |
| `GET` | `/v1/accounts/:id` | Dettaglio |
| `GET` | `/v1/accounts/:id/balances` | Saldi (amount string) |
| `GET` | `/v1/transactions` | Filtri + cursor; `format=csv` opzionale |
| `GET` | `/v1/transactions/export` | CSV fino a 5000 |
| `GET` | `/v1/transactions/:id` | Dettaglio |
| `GET` | `/v1/summary` | Saldi + aggregati per valuta |
| `GET` | `/v1/cashflow` | Serie inflow/outflow/net |
| `GET` | `/v1/sync/status` | Freshness (`data_freshness_at`) |
| `POST` | `/v1/sync/request` | Sync on-demand (cooldown 5m) |

Esempi JSON realistici e query complete: **`api-contract-v1.md`**.

### Shape movimenti (riepilogo)

```json
{
  "data": [
    {
      "id": "…",
      "tenant_id": "…",
      "bank_account_id": "…",
      "external_transaction_id": "…",
      "amount": "-4.50",
      "currency": "EUR",
      "booking_date": "2026-07-24",
      "value_date": "2026-07-24",
      "description": "…",
      "counterparty_name": "…",
      "counterparty_iban": "…",
      "status": "booked",
      "created_at": "…",
      "updated_at": "…"
    }
  ],
  "pagination": {
    "next_cursor": "…",
    "has_more": true
  }
}
```

---

## Importi

- Sempre **stringhe** (`"1234.56"`, `"-4.50"`), mai number JSON.
- Negativo = uscita (convenzione Fintable).
- Valute mai sommate tra loro.

---

## Rate limit e freshness

- Default API: **120 richieste / minuto** per API key (`API_RATE_LIMIT_*`).
- `POST /v1/sync/request`: cooldown **5 minuti** per connection; `request_provider_sync: true` rispetta anche il rate Fintable (~1/ora).
- Cron sync Spendo: default ogni **15 minuti** (`SYNC_CRON`).
- Controllare `data_freshness_at` su `GET /v1/sync/status` (o `last_update_at` su summary).

---

## Errori

```json
{
  "error": {
    "code": "forbidden",
    "message": "Tenant not permitted for this application"
  }
}
```

Codici: `unauthorized`, `forbidden`, `not_found`, `bad_request`, `validation_error`, `rate_limited`, `internal_error`.

---

## Flusso consigliato per History

1. `GET /v1/tenants` → salvare tenant.
2. `GET /v1/accounts` → mappare conti (IBAN / nome) a domain History; FK = `id` Spendo.
3. Poll `GET /v1/sync/status` per freshness; sync on-demand solo se necessario.
4. Poll `GET /v1/transactions` con `date_from` + cursor; upsert per `id`.
5. Saldi: `GET /v1/accounts/:id/balances` o `GET /v1/summary`.
6. Export: `GET /v1/transactions/export` per batch/CSV.
7. Webhook outbound (se configurati da arfly via Admin): hint; riconciliare sempre con GET. Dettagli: [`webhooks.md`](./webhooks.md).

**Preferire poll** rispetto a `sync/request` aggressivo.

### Mapping dominio

| Spendo | History |
| --- | --- |
| `tenants.id` | azienda / workspace banking |
| `accounts.id` + `iban` | conto bancario |
| `transactions.id` | movimento (idempotent key) |
| `amount` (string) + `currency` | importo |
| `booking_date`, `description`, `counterparty_*` | matching / regole business |

---

## Cosa NON chiamare

- **`/admin/api/*`** e Admin UI — solo operatori arfly.
- **API Fintable** — nessun PAT lato SaaS.
- Endpoint non documentati in `api-contract-v1.md`.

---

## Esempio curl

```bash
export SPENDO_KEY='spk_…'
export BASE='http://localhost:3000'

curl -s -H "Authorization: Bearer $SPENDO_KEY" "$BASE/v1/tenants" | jq
curl -s -H "Authorization: Bearer $SPENDO_KEY" "$BASE/v1/accounts" | jq
curl -s -H "Authorization: Bearer $SPENDO_KEY" \
  "$BASE/v1/transactions?limit=50&date_from=2026-01-01" | jq
curl -s -H "Authorization: Bearer $SPENDO_KEY" "$BASE/v1/sync/status" | jq
curl -s -H "Authorization: Bearer $SPENDO_KEY" "$BASE/v1/summary" | jq
```

---

## Audit

Accessi loggati in `audit_logs` (action, resource, ids). Secret e payload bancari grezzi non finiscono nei metadata di audit.

---

## Cheat sheet (incolla in chat)

```
Spendo Banking Hub — integrazione History
Base: http://localhost:3000  (prod: URL arfly)
Auth: Authorization: Bearer spk_…
Permessi: accounts:read | balances:read | transactions:read | sync:request
Tenant: mono → ometti tenant_id; multi → obbligatorio
Importi: SEMPRE stringhe decimali ("-4.50"), mai number
Paginazione: cursor + limit≤200; has_more / next_cursor
Rate: 120 req/min/key; sync request cooldown 5m

Primi endpoint:
  GET  /health
  GET  /v1/tenants
  GET  /v1/accounts
  GET  /v1/sync/status
  GET  /v1/transactions?limit=50&date_from=YYYY-MM-DD
  GET  /v1/accounts/:id/balances
  GET  /v1/summary
  POST /v1/sync/request   { "request_provider_sync": false }  (opzionale)

Export CSV: GET /v1/transactions/export
Cashflow:   GET /v1/cashflow?granularity=month
NON chiamare: /admin/api/*, Fintable API
Docs: /docs  |  contratto: docs/api-contract-v1.md
```
