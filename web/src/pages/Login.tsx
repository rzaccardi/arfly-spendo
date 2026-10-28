import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { ApiError } from '../api';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mfaToken) {
        const result = await login({
          mfa_token: mfaToken,
          totp_code: useRecovery ? undefined : totpCode,
          recovery_code: useRecovery ? totpCode : undefined,
        });
        if (!result.mfa_required) {
          navigate('/', { replace: true });
        }
        return;
      }

      const result = await login({ password });
      if (result.mfa_required) {
        setMfaToken(result.mfa_token);
        setTotpCode('');
        return;
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Accesso non riuscito');
    } finally {
      setBusy(false);
    }
  }

  function backToPassword() {
    setMfaToken(null);
    setTotpCode('');
    setUseRecovery(false);
    setError(null);
  }

  return (
    <div className="login-page">
      <form className="login-panel" onSubmit={(e) => void onSubmit(e)}>
        <div className="login-brand">Spendo</div>
        <p className="login-sub">Console operatori arfly — Banking Hub</p>

        {!mfaToken ? (
          <div className="field">
            <label htmlFor="password">Password admin</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Inserisci il codice dall&apos;app di autenticazione
              {useRecovery ? ' oppure un codice di recupero' : ''}.
            </p>
            <div className="field">
              <label htmlFor="totp">{useRecovery ? 'Codice di recupero' : 'Codice TOTP'}</label>
              <input
                id="totp"
                type="text"
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                required
                autoFocus
              />
            </div>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              <button
                type="button"
                className="linkish"
                onClick={() => {
                  setUseRecovery((v) => !v);
                  setTotpCode('');
                }}
              >
                {useRecovery ? 'Usa codice app' : 'Usa codice di recupero'}
              </button>
              {' · '}
              <button type="button" className="linkish" onClick={backToPassword}>
                Torna alla password
              </button>
            </p>
          </>
        )}

        {error && <p className="error">{error}</p>}
        <button className="btn accent" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Accesso…' : mfaToken ? 'Verifica' : 'Entra'}
        </button>
      </form>
    </div>
  );
}
