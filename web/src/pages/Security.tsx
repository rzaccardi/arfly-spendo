import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';

type MfaStatus = {
  enabled: boolean;
  setup_pending: boolean;
  recovery_codes_remaining: number;
};

type SetupData = {
  secret: string;
  otpauth_url: string;
  issuer: string;
  account: string;
};

export function SecurityPage() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [regenCode, setRegenCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await api<{ data: MfaStatus }>('/admin/api/mfa');
    setStatus(res.data);
  }

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, []);

  async function startSetup() {
    setBusy(true);
    setError(null);
    setMessage(null);
    setRecoveryCodes(null);
    try {
      const res = await api<{ data: SetupData }>('/admin/api/mfa/setup', { method: 'POST' });
      setSetup(res.data);
      setMessage('Aggiungi Spendo all’app di autenticazione, poi conferma con un codice.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup non riuscito');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ data: { recovery_codes: string[] } }>('/admin/api/mfa/confirm', {
        method: 'POST',
        json: { totp_code: confirmCode },
      });
      setRecoveryCodes(res.data.recovery_codes);
      setSetup(null);
      setConfirmCode('');
      setMessage('MFA attivo. Salva i codici di recupero in un posto sicuro — non verranno più mostrati.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Conferma non riuscita');
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const isTotp = /^\d{6}$/.test(disableCode.replace(/\s+/g, ''));
      await api('/admin/api/mfa/disable', {
        method: 'POST',
        json: {
          password: disablePassword,
          totp_code: isTotp ? disableCode : undefined,
          recovery_code: isTotp ? undefined : disableCode,
        },
      });
      setDisablePassword('');
      setDisableCode('');
      setMessage('MFA disattivato.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disattivazione non riuscita');
    } finally {
      setBusy(false);
    }
  }

  async function regenCodes(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ data: { recovery_codes: string[] } }>(
        '/admin/api/mfa/recovery-codes',
        {
          method: 'POST',
          json: { totp_code: regenCode },
        },
      );
      setRecoveryCodes(res.data.recovery_codes);
      setRegenCode('');
      setMessage('Nuovi codici di recupero generati. I precedenti non sono più validi.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Rigenerazione non riuscita');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sicurezza</h1>
          <p>Autenticazione a due fattori (TOTP) per il login admin.</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="ok-msg">{message}</p>}

      <section className="panel">
        <h2>Stato MFA</h2>
        {!status ? (
          <p className="muted">Caricamento…</p>
        ) : (
          <ul className="plain-list">
            <li>
              Stato: <strong>{status.enabled ? 'Attivo' : 'Non attivo'}</strong>
            </li>
            <li>Codici di recupero rimasti: {status.recovery_codes_remaining}</li>
            {status.setup_pending && <li>Setup in corso — conferma il codice dall’app.</li>}
          </ul>
        )}
      </section>

      {recoveryCodes && (
        <section className="panel warn-panel">
          <h2>Codici di recupero</h2>
          <p className="muted">Copiali ora. Ogni codice è monouso.</p>
          <ul className="recovery-codes">
            {recoveryCodes.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
        </section>
      )}

      {status && !status.enabled && (
        <section className="panel">
          <h2>Attiva authenticator</h2>
          {!setup ? (
            <button className="btn accent" type="button" disabled={busy} onClick={() => void startSetup()}>
              Avvia setup MFA
            </button>
          ) : (
            <>
              <p className="muted">
                Nell’app di autenticazione scegli “account basato su chiave” / inserimento manuale e
                usa questo secret, oppure apri l’URI otpauth sul telefono.
              </p>
              <div className="field">
                <label>Secret (Base32)</label>
                <input readOnly value={setup.secret} onFocus={(e) => e.target.select()} />
              </div>
              <div className="field">
                <label>URI otpauth</label>
                <textarea readOnly rows={3} value={setup.otpauth_url} onFocus={(e) => e.target.select()} />
              </div>
              <form onSubmit={(e) => void confirmSetup(e)}>
                <div className="field">
                  <label htmlFor="confirm-totp">Codice di verifica</label>
                  <input
                    id="confirm-totp"
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                </div>
                <button className="btn accent" type="submit" disabled={busy}>
                  Conferma e attiva
                </button>
              </form>
            </>
          )}
        </section>
      )}

      {status?.enabled && (
        <>
          <section className="panel">
            <h2>Rigenera codici di recupero</h2>
            <form onSubmit={(e) => void regenCodes(e)}>
              <div className="field">
                <label htmlFor="regen-totp">Codice TOTP corrente</label>
                <input
                  id="regen-totp"
                  value={regenCode}
                  onChange={(e) => setRegenCode(e.target.value)}
                  inputMode="numeric"
                  required
                />
              </div>
              <button className="btn secondary" type="submit" disabled={busy}>
                Genera nuovi codici
              </button>
            </form>
          </section>

          <section className="panel">
            <h2>Disattiva MFA</h2>
            <form onSubmit={(e) => void disableMfa(e)}>
              <div className="field">
                <label htmlFor="disable-password">Password admin</label>
                <input
                  id="disable-password"
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="disable-totp">Codice TOTP (o recovery)</label>
                <input
                  id="disable-totp"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  required
                />
              </div>
              <button className="btn danger" type="submit" disabled={busy}>
                Disattiva MFA
              </button>
            </form>
          </section>
        </>
      )}
    </>
  );
}
