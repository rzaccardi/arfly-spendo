import { useEffect, useMemo, useState, type FormEvent } from 'react';
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

type Workspace = {
  id: string;
  name: string;
  role: string;
  is_default: boolean;
  granted: boolean;
};

export function ConnectionsPage() {
  const [rows, setRows] = useState<Conn[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspacesError, setWorkspacesError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [token, setToken] = useState('');
  const [useEnv, setUseEnv] = useState(true);
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const workspaceById = useMemo(() => {
    const map = new Map<string, Workspace>();
    for (const workspace of workspaces) map.set(workspace.id, workspace);
    return map;
  }, [workspaces]);

  const workspaceOptions = useMemo(() => {
    const options = [...workspaces];
    if (workspaceId && !workspaceById.has(workspaceId)) {
      options.unshift({
        id: workspaceId,
        name: 'Salvato, non visibile a questo token',
        role: '',
        is_default: false,
        granted: false,
      });
    }
    return options;
  }, [workspaceById, workspaceId, workspaces]);

  async function loadWorkspaces() {
    try {
      const res = await api<{ data: Omit<Workspace, 'granted'>[] }>('/admin/api/fintable/workspaces');
      setWorkspaces(res.data.map((workspace) => ({ ...workspace, granted: true })));
      setWorkspacesError(null);
    } catch (err) {
      setWorkspaces([]);
      setWorkspacesError(err instanceof Error ? err.message : 'Impossibile leggere i workspace');
    }
  }

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
    void loadWorkspaces();
  }, []);

  function resetForm() {
    setEditingId(null);
    setWorkspaceId('');
    setToken('');
    setUseEnv(true);
    setStatus('active');
  }

  function startEdit(connection: Conn) {
    setEditingId(connection.id);
    setTenantId(connection.tenant_id);
    setWorkspaceId(connection.workspace_id);
    setToken('');
    setUseEnv(false);
    setStatus(connection.status === 'inactive' ? 'inactive' : 'active');
    setError(null);
    setMessage(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const payload = {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        use_env_token: useEnv && !token,
        token: token || undefined,
        ...(editingId ? { status } : {}),
      };
      if (editingId) {
        await api(`/admin/api/connections/${editingId}`, { method: 'PATCH', json: payload });
        setMessage('Connessione aggiornata. Il token resta cifrato e non viene mostrato.');
      } else {
        await api('/admin/api/connections', { method: 'POST', json: payload });
        setMessage('Connessione salvata. Il token resta cifrato e non viene mostrato.');
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function sync(id: string) {
    setMessage(null);
    try {
      const res = await api<{ data: { status: string; recordsProcessed: number; errorMessage?: string } }>(
        `/admin/api/connections/${id}/sync`,
        { method: 'POST' },
      );
      const detail = res.data.errorMessage ? ` — ${res.data.errorMessage}` : '';
      setMessage(`Sync: ${res.data.status} (${res.data.recordsProcessed} record)${detail}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function deactivate(id: string) {
    if (!confirm('Disattivare questa connessione?')) return;
    try {
      await api(`/admin/api/connections/${id}/deactivate`, { method: 'POST' });
      if (editingId === id) setStatus('inactive');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  function workspaceLabel(workspace: Workspace) {
    const bits = [workspace.name];
    if (workspace.is_default) bits.push('predefinito');
    if (workspace.role) bits.push(workspace.role);
    bits.push(workspace.id);
    return bits.join(' · ');
  }

  const selected = workspaceId ? workspaceById.get(workspaceId) : undefined;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Connessioni Fintable</h1>
          <p>Link workspace → tenant. I token non compaiono mai in elenco.</p>
        </div>
      </div>

      <section className="section">
        <h2>{editingId ? 'Modifica connessione' : 'Nuova connessione'}</h2>
        <form onSubmit={(e) => void save(e)} className="form-grid">
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
            <label>Workspace Fintable</label>
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              required
            >
              <option value="" disabled>
                {workspacesError ? 'Elenco non disponibile' : 'Scegli un workspace'}
              </option>
              {workspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspaceLabel(workspace)}
                </option>
              ))}
            </select>
            <p className="muted field-hint">
              Elenco letto da Fintable con il token del server. Compare solo un workspace con grant
              su quel token.
            </p>
            {selected && (
              <p className="muted field-hint">
                Selezionato: {selected.name}
                {selected.is_default ? ' (predefinito)' : ''}
              </p>
            )}
            {workspaceId && !workspaceById.has(workspaceId) && (
              <p className="error field-hint">
                Questo ID è salvato, ma il token del server non lo vede. In Fintable, Dashboard →
                API, aggiungi il grant sul token e aggiorna l’elenco.
              </p>
            )}
          </div>
          {editingId && (
            <div className="field">
              <label>Stato</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value === 'inactive' ? 'inactive' : 'active')}
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </div>
          )}
          <div className="field">
            <label>{editingId ? 'Nuovo token (opzionale)' : 'Token (opz. se usi env)'}</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={editingId ? 'Vuoto = tieni il token salvato' : 'Incolla PAT o lascia vuoto'}
              autoComplete="new-password"
            />
          </div>
          <div className="field">
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={useEnv}
                onChange={(e) => setUseEnv(e.target.checked)}
              />
              {editingId
                ? 'Sostituisci con FINTABLE_API_TOKEN del server'
                : 'Usa FINTABLE_API_TOKEN del server'}
            </label>
          </div>
          <div style={{ alignSelf: 'end' }} className="inline-actions">
            <button className="btn accent" type="submit" disabled={!workspaceId}>
              {editingId ? 'Salva modifiche' : 'Salva'}
            </button>
            {editingId && (
              <button className="btn secondary" type="button" onClick={resetForm}>
                Annulla
              </button>
            )}
            <button className="btn secondary" type="button" onClick={() => void loadWorkspaces()}>
              Aggiorna elenco
            </button>
          </div>
        </form>
        {workspacesError && <p className="error">{workspacesError}</p>}
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
                    Nessuna connessione Fintable.
                  </td>
                </tr>
              )}
              {rows.map((c) => {
                const known = workspaceById.get(c.workspace_id);
                return (
                  <tr key={c.id} className={editingId === c.id ? 'is-editing' : undefined}>
                    <td>{c.tenant_name ?? c.tenant_id.slice(0, 8)}</td>
                    <td>
                      {known ? known.name : 'Non visibile al token'}
                      <div className="mono muted">{c.workspace_id}</div>
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td>
                      {c.last_sync_at ? new Date(c.last_sync_at).toLocaleString('it-IT') : '—'}
                    </td>
                    <td className="muted">{c.last_error ?? '—'}</td>
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => startEdit(c)}
                        >
                          Modifica
                        </button>
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
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
