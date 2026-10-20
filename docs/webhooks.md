# Spendo outbound webhooks (skeleton)

Le subscription sono gestite dall’**operatore** via Admin API (`/admin/api/webhooks`), non dalla SaaS su `/v1`.  
History può ricevere eventi se arfly registra un URL HTTPS. Per integrazione primaria preferire il **poll** su `/v1` (vedi [`api-contract-v1.md`](./api-contract-v1.md)).

Il delivery worker con retry esiste ma non è ancora pienamente productionizzato; l’admin può creare subscription e inviare una test delivery firmata.

## Eventi (`WEBHOOK_EVENTS`)

| Evento | Emesso tipicamente quando |
| --- | --- |
| `transaction.created` | Nuovo movimento upsertato in sync |
| `transaction.updated` | Movimento aggiornato in sync |
| `account.balance_updated` | Saldo aggiornato in sync |
| `sync.completed` | Job sync riuscito |
| `sync.failed` | Job sync fallito |
| `connection.expired` | Auth provider 401/403 |
| `connection.updated` | Definito nel catalogo eventi |

## Admin API (operatori only)

- `GET /admin/api/webhooks?tenant_id=`
- `POST /admin/api/webhooks` — body: `{ tenant_id, url, events[], description?, secret? }`  
  Restituisce `signing_secret` **una sola volta** (auto-generato se omesso).
- `DELETE /admin/api/webhooks/:id`
- `POST /admin/api/webhooks/:id/test` — tentativo outbound firmato
- `GET /admin/api/webhooks/:id/deliveries`

## Envelope

```json
{
  "id": "evt_…",
  "event": "transaction.created",
  "created_at": "2026-10-20T18:45:01.000Z",
  "data": { }
}
```

Esempi `data` per evento: vedi sezione webhook in `api-contract-v1.md`.

## Signature

Header della richiesta outbound:

- `Content-Type: application/json`
- `X-Spendo-Timestamp` — unix seconds
- `X-Spendo-Signature` — hex HMAC-SHA256 di `{timestamp}.{rawBody}` con il secret della subscription
- `X-Spendo-Event` — nome evento

Verificare ricalcolando l’HMAC e confrontando in tempo costante. Rifiutare se lo skew del timestamp è eccessivo (es. ±5 minuti).
