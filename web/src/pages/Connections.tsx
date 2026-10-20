import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';

type Conn = {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  provider: string;
  workspace_id: string;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
};

type Tenant = { id: string; name: string };

export function ConnectionsPage() {
  const [rows, setRows] = useState<Conn[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [token, setToken] = useState('');
  const [useEnv, setUseEnv] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [c, t] = await Promise.all([
      api<{ data: Conn[] }>('/admin/api/connections'),
      api<{ data: Tenant[] }>('/admin/api/tenants'),
    ]);
    setRows(c.data);
    setTenants(t.data);
    if (!tenantId && t.data[0]) setTenantId(t.data[0].id);
  }

  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, []);

  async function upsert(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api('/admin/api/connections', {
        method: 'POST',
        json: {
          tenant_id: tenantId,
          workspace_id: workspaceId,
          use_env_token: useEnv && !token,
          token: token || undefined,
        },
      });
      setWorkspaceId('');
      setToken('');
      setMessage('Connessione salvata (token cifrato, non mostrato).');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function sync(id: string) {
    setMessage(null);
    try {
      const res = await api<{ data: { status: string; recordsProcessed: number } }>(
        `/admin/api/connections/${id}/sync`,
        { method: 'POST' },
      );
      setMessage(`Sync: ${res.data.status} (${res.data.recordsProcessed} record)`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function deactivate(id: string) {
    if (!confirm('Disattivare questa connessione?')) return;
    try {
      await api(`/admin/api/connections/${id}/deactivate`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Connessioni Fintable</h1>
          <p>Link workspace → tenant. I token non compaiono mai in elenco.</p>
        </div>
      </div>

      <section className="section">
        <h2>Registra / aggiorna</h2>
        <form onSubmit={(e) => void upsert(e)} className="form-grid">
          <div className="field">
            <label>Tenant</label>
            <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} required>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Workspace ID</label>
            <input
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              placeholder="ws_…"
              required
            />
          </div>
          <div className="field">
            <label>Token (opz. se usi env)</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Incolla PAT o lascia vuoto"
            />
          </div>
          <div className="field">
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={useEnv}
                onChange={(e) => setUseEnv(e.target.checked)}
              />
              Usa FINTABLE_API_TOKEN da .env
            </label>
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn accent" type="submit">
              Salva
            </button>
          </div>
        </form>
        {error && <p className="error">{error}</p>}
        {message && <p className="muted">{message}</p>}
      </section>

      <section className="section">
        <h2>Elenco</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Workspace</th>
                <th>Stato</th>
                <th>Ultimo sync</th>
                <th>Errore</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    Nessuna connessione Fintable. Registra un workspace sopra (es. History).
                  </td>
                </tr>
              )}
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.tenant_name ?? c.tenant_id.slice(0, 8)}</td>
                  <td className="mono">{c.workspace_id}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td>
                    {c.last_sync_at
                      ? new Date(c.last_sync_at).toLocaleString('it-IT')
                      : '—'}
                  </td>
                  <td className="muted">{c.last_error ?? '—'}</td>
                  <td>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={c.status !== 'active'}
                        onClick={() => void sync(c.id)}
                      >
                        Sync
                      </button>
                      <button
                        type="button"
                        className="btn danger"
                        disabled={c.status !== 'active'}
                        onClick={() => void deactivate(c.id)}
                      >
                        Disattiva
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
