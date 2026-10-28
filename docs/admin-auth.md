# Admin auth — password, MFA TOTP, anti brute-force

La console operatori (`/admin/api` + Admin UI) è **separata** dalle chiavi SaaS `spk_`. Non usa Supabase Auth.

## Credenziali

| Modalità | Uso |
| --- | --- |
| `ADMIN_PASSWORD` | Login cookie `spendo_admin_session` (UI) |
| `ADMIN_API_KEY` / `ADMIN_TOKEN` | Bearer su `/admin/api/*` (script / CI) — **bypass MFA** |

## MFA (TOTP)

1. Accedi con la password.
2. Apri **Sicurezza** → Avvia setup MFA → aggiungi secret / URI `otpauth` in Google Authenticator, 1Password, Authy, ecc.
3. Conferma con un codice a 6 cifre → salva i **codici di recupero** (monouso, mostrati una sola volta).
4. Al login successivo: password → codice TOTP (o recovery).

Endpoint:

- `GET /admin/api/mfa` — stato
- `POST /admin/api/mfa/setup` — genera secret pending
- `POST /admin/api/mfa/confirm` — `{ totp_code }` → attiva + `recovery_codes`
- `POST /admin/api/mfa/disable` — `{ password, totp_code \| recovery_code }`
- `POST /admin/api/mfa/recovery-codes` — `{ totp_code }` → nuovi codici

Login:

```http
POST /admin/api/login
{ "password": "…" }
→ { "data": { "mfa_required": true, "mfa_token": "…", "expires_in_seconds": 300 } }

POST /admin/api/login
{ "mfa_token": "…", "totp_code": "123456" }
→ cookie di sessione

# oppure one-shot
{ "password": "…", "totp_code": "123456" }
```

Secret TOTP cifrato con `ENCRYPTION_KEY` (AES-GCM) in tabella `admin_mfa_settings`.

## Anti brute-force

Su `POST /admin/api/login`:

1. **Rate limit** Fastify dedicato (`ADMIN_LOGIN_RATE_MAX` / window).
2. **Lockout progressivo** in-memory per IP: dopo `ADMIN_LOGIN_MAX_ATTEMPTS` fallimenti nella finestra → blocco `ADMIN_LOGIN_LOCKOUT_MS` → `429 rate_limited` con `retry_after_seconds`.
3. **Delay** crescente sui fallimenti (max ~2s).

Nota: il lockout è per processo Node. Con più istanze App Platform senza store condiviso, ogni replica ha il proprio contatore (ancora utile; per lockout globale servirebbe Redis/DB).

## Env

Vedi `.env.example` (`ADMIN_LOGIN_*`, `ADMIN_MFA_CHALLENGE_TTL_SECONDS`).
