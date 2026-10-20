import { useEffect, useState } from 'react';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';

type Overview = {
  tenants: number;
  accounts: number;
  transactions: number;
  connections: number;
  applications: number;
  sync_succeeded_24h: number;
  sync_failed_24h: number;
  api_calls_24h: number;
  recent_jobs: Array<{
    id: string;
    tenant_id: string;
    status: string;
    records_processed: number;
    error_message: string | null;
    created_at: string;
  }>;
};

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ data: Overview }>('/admin/api/overview')
      .then((r) => setData(r.data))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Caricamento panoramica…</p>;

  const stats = [
    { label: 'Tenant', value: data.tenants },
    { label: 'Conti', value: data.accounts },
    { label: 'Movimenti', value: data.transactions },
    { label: 'Connessioni', value: data.connections },
    { label: 'App SaaS', value: data.applications },
    { label: 'Sync OK 24h', value: data.sync_succeeded_24h },
    { label: 'Sync KO 24h', value: data.sync_failed_24h },
    { label: 'Chiamate API 24h', value: data.api_calls_24h },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Panoramica</h1>
          <p>Stato operativo del Banking Hub Spendo.</p>
        </div>
      </div>
      <div className="stats">
        {stats.map((s) => (
          <div key={s.label} className="stat">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>
      <section className="section">
        <h2>Ultimi sync job</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stato</th>
                <th>Tenant</th>
                <th>Record</th>
                <th>Quando</th>
                <th>Errore</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="mono">{j.tenant_id.slice(0, 8)}…</td>
                  <td>{j.records_processed}</td>
                  <td>{new Date(j.created_at).toLocaleString('it-IT')}</td>
                  <td className="muted">{j.error_message ?? '—'}</td>
                </tr>
              ))}
              {data.recent_jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-state">
                    Nessun job recente. Avvia un sync dalla pagina Sync job o Connessioni.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
