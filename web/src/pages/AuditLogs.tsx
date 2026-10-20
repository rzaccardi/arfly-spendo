import { useEffect, useState } from 'react';
import { api } from '../api';

type Log = {
  id: string;
  tenant_id: string | null;
  application_id: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  timestamp: string;
  metadata: Record<string, unknown>;
};

type Tenant = { id: string; name: string };

export function AuditLogsPage() {
  const [rows, setRows] = useState<Log[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [action, setAction] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const qs = new URLSearchParams();
    if (tenantId) qs.set('tenant_id', tenantId);
    if (action) qs.set('action', action);
    qs.set('limit', '80');
    const [logs, t] = await Promise.all([
      api<{ data: Log[] }>(`/admin/api/audit-logs?${qs}`),
      api<{ data: Tenant[] }>('/admin/api/tenants'),
    ]);
    setRows(logs.data);
    setTenants(t.data);
  }

  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>Eventi recenti (senza segreti).</p>
        </div>
      </div>

      <div className="toolbar">
        <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">Tutti i tenant</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Filtra action…"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <button type="button" className="btn secondary" onClick={() => void load()}>
          Filtra
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Action</th>
              <th>Resource</th>
              <th>Tenant</th>
              <th>App</th>
              <th>Meta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.timestamp).toLocaleString('it-IT')}</td>
                <td className="mono">{r.action}</td>
                <td>
                  {r.resource}
                  {r.resource_id ? (
                    <div className="muted mono">{r.resource_id.slice(0, 12)}…</div>
                  ) : null}
                </td>
                <td className="mono">{r.tenant_id ? `${r.tenant_id.slice(0, 8)}…` : '—'}</td>
                <td className="mono">
                  {r.application_id ? `${r.application_id.slice(0, 8)}…` : '—'}
                </td>
                <td className="mono muted">{JSON.stringify(r.metadata ?? {})}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
