import { useEffect, useState } from 'react';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';

type Job = {
  id: string;
  tenant_id: string;
  provider_connection_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  records_processed: number;
  created_at: string;
};

type Conn = { id: string; tenant_name: string | null; workspace_id: string; status: string };

export function SyncJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [connections, setConnections] = useState<Conn[]>([]);
  const [connId, setConnId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [j, c] = await Promise.all([
      api<{ data: Job[] }>('/admin/api/sync-jobs?limit=50'),
      api<{ data: Conn[] }>('/admin/api/connections'),
    ]);
    setJobs(j.data);
    setConnections(c.data.filter((x) => x.status === 'active'));
    if (!connId && c.data[0]) setConnId(c.data.find((x) => x.status === 'active')?.id ?? '');
  }

  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, []);

  async function trigger() {
    if (!connId) return;
    setError(null);
    try {
      const res = await api<{ data: { status: string; recordsProcessed: number } }>(
        '/admin/api/sync-jobs/trigger',
        { method: 'POST', json: { provider_connection_id: connId } },
      );
      setMessage(`Avviato: ${res.data.status} — ${res.data.recordsProcessed} record`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sync job</h1>
          <p>Job recenti e trigger manuale.</p>
        </div>
      </div>

      <section className="section">
        <h2>Trigger manuale</h2>
        <div className="toolbar">
          <select value={connId} onChange={(e) => setConnId(e.target.value)}>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {(c.tenant_name ?? 'tenant')} · {c.workspace_id}
              </option>
            ))}
          </select>
          <button type="button" className="btn accent" onClick={() => void trigger()} disabled={!connId}>
            Avvia sync
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {message && <p className="muted">{message}</p>}
      </section>

      <section className="section">
        <h2>Recenti</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stato</th>
                <th>Tenant</th>
                <th>Connection</th>
                <th>Record</th>
                <th>Inizio</th>
                <th>Fine</th>
                <th>Errore</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    Nessun sync job. Seleziona una connessione e premi «Avvia sync».
                  </td>
                </tr>
              )}
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="mono">{j.tenant_id.slice(0, 8)}…</td>
                  <td className="mono">{j.provider_connection_id.slice(0, 8)}…</td>
                  <td>{j.records_processed}</td>
                  <td>
                    {j.started_at ? new Date(j.started_at).toLocaleString('it-IT') : '—'}
                  </td>
                  <td>
                    {j.completed_at
                      ? new Date(j.completed_at).toLocaleString('it-IT')
                      : '—'}
                  </td>
                  <td className="muted">{j.error_message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
