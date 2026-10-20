# Spendo API — Contratto `/v1` (completo)

Contratto ufficiale per l’integrazione SaaS (es. History su `manage.historyroma3z.it`) con **Spendo Banking Hub**.  
Derivato dalle route in `src/api/routes/*`, dagli serializer in `src/domain/*` e dalla config runtime. **Non inventare endpoint** oltre a quelli elencati qui.

OpenAPI interattivo (quando l’API è in esecuzione): `GET /docs`.

---

## 1. Base URL

| Ambiente | URL |
| --- | --- |
| Locale (default) | `http://localhost:3000` |
| Produzione / staging | URL fornito da arfly (stesso path `/v1/...`) |

Prefisso API: **`/v1`**. Health: `GET /health` (senza auth).

---

## 2. Autenticazione

```http
Authorization: Bearer spk_<secret>
```

- Chiavi emesse per **application** (seed / bootstrap / Admin UI).
- Solo il **prefix** è usato per lookup; il secret è hashed (argon2).
- Chiavi scadute o revoke → `401 unauthorized`.
- **Non** usare PAT Fintable, cookie admin, né `ADMIN_API_KEY`.

---

## 3. Permessi

Permessi ammessi (`src/auth/permissions.ts`):

| Permesso | Endpoint tipici |
| --- | --- |
| `accounts:read` | `GET /v1/tenants`, `GET /v1/accounts`, `GET /v1/accounts/:id`, `GET /v1/sync/status` |
| `balances:read` | `GET /v1/accounts/:id/balances`, `GET /v1/summary`, `GET /v1/cashflow` |
| `transactions:read` | `GET /v1/transactions`, `GET /v1/transactions/:id`, `GET /v1/transactions/export` |
| `sync:request` | `POST /v1/sync/request` |

I permessi sono concessi **per tenant** (`application_tenant_permissions`).

---

## 4. Risoluzione tenant

Ogni application ha uno o più tenant consentiti.

| Caso | Comportamento |
| --- | --- |
| **Un solo tenant** con il permesso richiesto | `tenant_id` **opzionale** — Spendo usa quel tenant |
| **Più tenant** | `tenant_id` (UUID) **obbligatorio** in query o body → altrimenti `400 bad_request` |
| Tenant non consentito | `403 forbidden` |
| Risorsa di altro tenant (ID forgiato) | `404 not_found` (nessuna leak di esistenza) |

Helper usato dalle liste: `resolveListTenantFilter` / `resolveTenantId` in `src/auth/context.ts`.

---

## 5. Importi (critico)

- Sempre **stringhe decimali**, mai number JSON: `"5240.12"`, `"-4.50"`.
- Negativo = uscita (stessa convenzione Fintable).
- Valute **mai** sommate tra loro (summary/cashflow sono keyed by currency).
- Storage Postgres `NUMERIC`; API non usa float.

---

## 6. Paginazione (cursor)

Usata da `GET /v1/transactions` (JSON).

```json
{
  "pagination": {
    "next_cursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA3LTI0VDEwOjAwOjAwLjAwMFoiLCJpZCI6IjU1MGUwNDAwLWUwMjktNDRjMS05NDE0LTFhZDYwNzI4YWUxMiJ9",
    "has_more": true
  }
}
```

- Cursor opaco (base64url di `{ createdAt, id }`).
- Ordine: `created_at DESC`, `id DESC`.
- `limit` default **50**, max **200** (Zod sulla query). Export CSV fino a **5000** righe.
- Passare `cursor=<next_cursor>` nella richiesta successiva finché `has_more` è `true`.
- Cursor invalido → `400 bad_request`.

---

## 7. Rate limit

| Parametro | Default |
| --- | --- |
| `API_RATE_LIMIT_MAX` | `120` |
| `API_RATE_LIMIT_TIME_WINDOW_MS` | `60000` (1 minuto) |

Chiave: header `Authorization` (altrimenti IP). Superato il limite → `429` (envelope Fastify rate-limit / `rate_limited` dove applicabile).

**Cooldown:** `POST /v1/sync/request` ha anche cooldown **5 minuti** per connection (`429 rate_limited`).

Con `request_provider_sync: true`, Fintable Office sync ha rate limit proprio (~1/ora); Spendo rispetta `Retry-After`.

---

## 8. Envelope errori

```json
{
  "error": {
    "code": "forbidden",
    "message": "Tenant not permitted for this application",
    "details": {}
  }
}
```

| HTTP | `code` tipico |
| --- | --- |
| 400 | `bad_request`, `validation_error` |
| 401 | `unauthorized` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 429 | `rate_limited` |
| 500 | `internal_error` |

Validazione Zod: `details` = output di `error.flatten()`.

---

## 9. Freshness / sync

Campi utili per sapere se i dati sono aggiornati:

| Campo | Dove |
| --- | --- |
| `data_freshness_at` / `last_successful_sync_at` | `GET /v1/sync/status` → `connections[]` |
| `last_sync_at`, `last_sync_attempt_at`, `last_error` | stesso |
| `last_update_at` | `GET /v1/summary` |
| `last_provider_update_at` | conto (`GET /v1/accounts`) |
| Cron worker | default `SYNC_CRON=*/15 * * * *` (ogni 15 min) |

`data_freshness_at` = alias di `last_successful_sync_at`.

---

## 10. Endpoint — riferimento completo

### 10.1 `GET /health`

**Auth:** nessuna.

```json
{
  "status": "ok",
  "service": "Spendo",
  "company": "arfly"
}
```

---

### 10.2 `GET /v1/tenants`

**Permesso:** preferibilmente `accounts:read` (se assente, lista i tenant a cui l’app ha *qualsiasi* grant).

```json
{
  "data": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "History Roma 3Z",
      "legal_name": "History Roma 3Z S.r.l.",
      "vat_number": "IT12345678901",
      "status": "active",
      "created_at": "2026-01-15T09:00:00.000Z",
      "updated_at": "2026-03-01T12:30:00.000Z"
    }
  ]
}
```

---

### 10.3 `GET /v1/tenants/:id`

**Params:** `id` UUID.

```json
{
  "data": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "History Roma 3Z",
    "legal_name": "History Roma 3Z S.r.l.",
    "vat_number": "IT12345678901",
    "status": "active",
    "created_at": "2026-01-15T09:00:00.000Z",
    "updated_at": "2026-03-01T12:30:00.000Z"
  }
}
```

---

### 10.4 `GET /v1/accounts`

**Permesso:** `accounts:read`

**Query:**

| Param | Tipo | Note |
| --- | --- | --- |
| `tenant_id` | UUID | obbligatorio se multi-tenant |
| `currency` | string(3) | es. `EUR` |
| `status` | string | es. `active` |

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "tenant_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "provider_connection_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "external_account_id": "acc_fintable_abc123",
      "name": "Conto corrente operativo",
      "iban": "IT60X0542811101000000123456",
      "currency": "EUR",
      "account_type": "checking",
      "status": "active",
      "last_provider_update_at": "2026-10-20T18:45:00.000Z",
      "created_at": "2026-02-01T10:00:00.000Z",
      "updated_at": "2026-10-20T18:45:00.000Z"
    }
  ]
}
```

**Mapping History sugerito:** salvare `id` Spendo come FK conto; usare `iban` / `name` per UI; `external_account_id` solo per debug (non chiamare Fintable).

---

### 10.5 `GET /v1/accounts/:id`

**Permesso:** `accounts:read`  
Stesso oggetto account di sopra in `{ "data": { ... } }`.

---

### 10.6 `GET /v1/accounts/:id/balances`

**Permesso:** `balances:read`  
Ultimo saldo per ogni `balance_type` (es. `booked`, `available`).

```json
{
  "data": [
    {
      "id": "b1000000-0000-4000-8000-000000000001",
      "tenant_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "bank_account_id": "550e8400-e29b-41d4-a716-446655440001",
      "balance_type": "booked",
      "amount": "5240.12",
      "currency": "EUR",
      "as_of": "2026-10-20T17:00:00.000Z",
      "retrieved_at": "2026-10-20T18:45:12.000Z"
    },
    {
      "id": "b1000000-0000-4000-8000-000000000002",
      "tenant_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "bank_account_id": "550e8400-e29b-41d4-a716-446655440001",
      "balance_type": "available",
      "amount": "5100.00",
      "currency": "EUR",
      "as_of": "2026-10-20T17:00:00.000Z",
      "retrieved_at": "2026-10-20T18:45:12.000Z"
    }
  ]
}
```

---

### 10.7 `GET /v1/transactions`

**Permesso:** `transactions:read`

**Query:**

| Param | Tipo | Note |
| --- | --- | --- |
| `tenant_id` | UUID | se multi-tenant |
| `account_id` | UUID | filtra per conto |
| `date_from` / `date_to` | string (YYYY-MM-DD) | su `booking_date` |
| `type` | `credit` \| `debit` | amount > 0 / < 0 |
| `status` | string | tipicamente `booked` |
| `min_amount` / `max_amount` | string decimale | confronto numerico |
| `q` | string | ILIKE su description, counterparty_name, counterparty_iban |
| `cursor` | string | paginazione |
| `limit` | int 1–200 | default 50 |
| `format` | `json` \| `csv` | `csv` → body CSV, max 5000 |

**Risposta JSON:**

```json
{
  "data": [
    {
      "id": "c2000000-0000-4000-8000-000000000010",
      "tenant_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "bank_account_id": "550e8400-e29b-41d4-a716-446655440001",
      "external_transaction_id": "tx_fintable_998877",
      "booking_date": "2026-10-18",
      "value_date": "2026-10-18",
      "amount": "-145.90",
      "currency": "EUR",
      "description": "Bonifico fornitore Alfa SpA",
      "counterparty_name": "Alfa SpA",
      "counterparty_iban": "IT12A0306909606100000123456",
      "status": "booked",
      "created_at": "2026-10-18T22:10:00.000Z",
      "updated_at": "2026-10-18T22:10:00.000Z"
    },
    {
      "id": "c2000000-0000-4000-8000-000000000011",
      "tenant_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "bank_account_id": "550e8400-e29b-41d4-a716-446655440001",
      "external_transaction_id": "tx_fintable_998878",
      "booking_date": "2026-10-19",
      "value_date": "2026-10-19",
      "amount": "2500.00",
      "currency": "EUR",
      "description": "Incasso fattura 2026/0412",
      "counterparty_name": "Cliente Beta Srl",
      "counterparty_iban": null,
      "status": "booked",
      "created_at": "2026-10-19T08:05:00.000Z",
      "updated_at": "2026-10-19T08:05:00.000Z"
    }
  ],
  "pagination": {
    "next_cursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTEwLTE4VDIyOjEwOjAwLjAwMFoiLCJpZCI6ImMyMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAxMCJ9",
    "has_more": true
  }
}
```

**Mapping History sugerito:**

| Campo Spendo | Uso dominio History |
| --- | --- |
| `id` | PK / idempotency chiave primaria |
| `external_transaction_id` | dedup verso provider (opzionale) |
| `bank_account_id` | FK conto |
| `amount` + `currency` | importo movimento (stringa) |
| `booking_date` | data contabile |
| `description` / `counterparty_*` | matching fatture / regole |
| `status` | stato movimento |

---

### 10.8 `GET /v1/transactions/export`

**Permesso:** `transactions:read`  
Stessi filtri di lista (senza cursor utile). Risposta: `text/csv; charset=utf-8`, fino a 5000 righe.

**Colonne CSV:**  
`id,tenant_id,bank_account_id,booking_date,value_date,amount,currency,description,counterparty_name,counterparty_iban,status`

Alternativa: `GET /v1/transactions?format=csv` (stesso CSV).

---

### 10.9 `GET /v1/transactions/:id`

**Permesso:** `transactions:read`  
Singolo oggetto transazione in `{ "data": { ... } }` (stesso shape della lista).

---

### 10.10 `GET /v1/summary`

**Permesso:** `balances:read`

**Query:** `tenant_id?`, `date_from?`, `date_to?` (periodo sui movimenti per inflow/outflow).

```json
{
  "data": {
    "accounts": [
      {
        "account_id": "550e8400-e29b-41d4-a716-446655440001",
        "account_name": "Conto corrente operativo",
        "currency": "EUR",
        "booked": "5240.12",
        "available": "5100.00",
        "as_of": "2026-10-20T17:00:00.000Z"
      }
    ],
    "aggregates": {
      "balances_by_currency": { "EUR": "5240.12" },
      "inflows_by_currency": { "EUR": "12500.00" },
      "outflows_by_currency": { "EUR": "7310.45" }
    },
    "transaction_count": 128,
    "period": {
      "date_from": "2026-10-01",
      "date_to": "2026-10-20"
    },
    "last_update_at": "2026-10-20T18:45:00.000Z"
  }
}
```

---

### 10.11 `GET /v1/cashflow`

**Permesso:** `balances:read`

**Query:** `tenant_id?`, `date_from?`, `date_to?`, `granularity` = `day` \| `week` \| `month` (default `month`).

```json
{
  "data": {
    "granularity": "month",
    "period": {
      "date_from": "2026-01-01",
      "date_to": "2026-10-20"
    },
    "by_currency": {
      "EUR": {
        "periods": [
          {
            "period": "2026-09",
            "inflow": "8200.00",
            "outflow": "6100.50",
            "net": "2099.50",
            "count": 42
          },
          {
            "period": "2026-10",
            "inflow": "4300.00",
            "outflow": "1209.95",
            "net": "3090.05",
            "count": 18
          }
        ],
        "totals": {
          "inflow": "12500.00",
          "outflow": "7310.45",
          "net": "5189.55",
          "count": 60
        }
      }
    }
  }
}
```

- `week`: chiave = lunedì ISO (YYYY-MM-DD).
- Valute mai mescolate.

---

### 10.12 `GET /v1/sync/status`

**Permesso:** `accounts:read`  
**Query:** `tenant_id?`

```json
{
  "data": {
    "connections": [
      {
        "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        "tenant_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "provider": "fintable",
        "workspace_id": "ws_history_roma3z",
        "status": "active",
        "last_sync_at": "2026-10-20T18:45:00.000Z",
        "last_sync_attempt_at": "2026-10-20T18:45:00.000Z",
        "last_successful_sync_at": "2026-10-20T18:45:00.000Z",
        "last_error": null,
        "data_freshness_at": "2026-10-20T18:45:00.000Z"
      }
    ],
    "recent_jobs": [
      {
        "id": "d3000000-0000-4000-8000-000000000020",
        "tenant_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "provider_connection_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        "status": "succeeded",
        "started_at": "2026-10-20T18:44:50.000Z",
        "completed_at": "2026-10-20T18:45:00.000Z",
        "error_message": null,
        "records_processed": 37
      }
    ]
  }
}
```

---

### 10.13 `POST /v1/sync/request`

**Permesso:** `sync:request`  
**Body JSON:**

```json
{
  "tenant_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "provider_connection_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "request_provider_sync": false
}
```

| Campo | Default | Note |
| --- | --- | --- |
| `tenant_id` | risolto se mono-tenant | obbligatorio se multi |
| `provider_connection_id` | tutte le connection active del tenant | UUID opzionale |
| `request_provider_sync` | `false` | se `true`, chiama anche Fintable `POST /sync` (rate limit provider) |

Cooldown 5 minuti per connection se `last_sync_attempt_at` recente → `429`.

**Risposta** (attenzione: campi in **camelCase**, come nel dominio SyncResult):

```json
{
  "data": [
    {
      "connectionId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "tenantId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "jobId": "d3000000-0000-4000-8000-000000000021",
      "status": "succeeded",
      "recordsProcessed": 12
    }
  ]
}
```

`status`: `succeeded` | `failed` | `skipped`. Su failure può comparire `errorMessage`.

---

## 11. Webhook outbound (opzionale)

Le subscription **non** si creano via `/v1`: le gestisce l’operatore su `/admin/api/webhooks` (vedi `docs/webhooks.md`).  
History può ricevere eventi se arfly configura l’URL HTTPS.

**Eventi supportati nel codice** (`WEBHOOK_EVENTS`):

- `transaction.created`
- `transaction.updated`
- `account.balance_updated`
- `sync.completed`
- `sync.failed`
- `connection.expired`
- `connection.updated` (definito; emissione principale oggi: sync + balance/tx)

**Envelope POST al receiver:**

```json
{
  "id": "evt_ab12cd34ef56",
  "event": "transaction.created",
  "created_at": "2026-10-20T18:45:01.000Z",
  "data": {
    "transaction_id": "c2000000-0000-4000-8000-000000000010",
    "account_id": "550e8400-e29b-41d4-a716-446655440001",
    "external_transaction_id": "tx_fintable_998877",
    "amount": "-145.90",
    "currency": "EUR",
    "booking_date": "2026-10-18"
  }
}
```

**Header:** `X-Spendo-Timestamp`, `X-Spendo-Signature` (HMAC-SHA256 hex di `{timestamp}.{rawBody}`), `X-Spendo-Event`.

**Stato:** delivery worker con retry è presente ma ancora in maturazione; per produzione History si raccomanda **poll** come path primario.

---

## 12. Cosa NON chiamare

| Superficie | Motivo |
| --- | --- |
| `/admin/api/*` | Solo operatori arfly (password / `ADMIN_API_KEY`) |
| Admin UI (`:5173`) | Console interna |
| API Fintable direttamente | PAT restano cifrati in Spendo |
| Endpoint non elencati qui | Non fanno parte del contratto SaaS |

---

## 13. Flusso consigliato per History SaaS

1. **Bootstrap:** `GET /health` → `GET /v1/tenants` → salvare `tenant_id`.
2. **Conti:** `GET /v1/accounts` → mappare IBAN/nome → entità conto History (`spendo_account_id`).
3. **Freshness:** `GET /v1/sync/status` — se `data_freshness_at` è troppo vecchio, opzionale `POST /v1/sync/request` con `request_provider_sync: false` (di solito basta il cron 15′).
4. **Movimenti:** poll incrementale `GET /v1/transactions?date_from=…&cursor=…` (o per `account_id`); upsert su `id` Spendo.
5. **Saldi / KPI:** `GET /v1/accounts/:id/balances` e/o `GET /v1/summary`.
6. **Export batch:** `GET /v1/transactions/export` per riconciliazioni offline.
7. **Webhook** (se attivati da arfly): usare come hint; riconciliare sempre con GET.

Preferire **poll** rispetto a sync on-demand aggressivo (cooldown + rate Fintable).

---

## 14. Cheat sheet (incolla in chat)

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
