import { useEffect, useState } from 'react';
import { api } from '../api';

type Tenant = { id: string; name: string };

type PeriodRow = {
  period: string;
  inflow: string;
  outflow: string;
  net: string;
  count: number;
};

type CashflowData = {
  granularity: string;
  period: { date_from: string | null; date_to: string | null };
  by_currency: Record<
    string,
    {
      periods: PeriodRow[];
      totals: { inflow: string; outflow: string; net: string; count: number };
    }
  >;
};

function defaultDateFrom(): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 5);
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

export function CashflowPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('month');
  const [data, setData] = useState<CashflowData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void api<{ data: Tenant[] }>('/admin/api/tenants')
      .then((r) => {
        setTenants(r.data);
        if (r.data[0]) setTenantId(r.data[0].id);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function load() {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        tenant_id: tenantId,
        granularity,
      });
      if (dateFrom) qs.set('date_from', dateFrom);
      if (dateTo) qs.set('date_to', dateTo);
      const res = await api<{ data: CashflowData }>(`/admin/api/cashflow?${qs}`);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (tenantId) void load();
  }, [tenantId, granularity]);

  const currencies = data ? Object.keys(data.by_currency).sort() : [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Flusso di cassa</h1>
          <p>Entrate e uscite per periodo, separate per valuta (mai sommate insieme).</p>
        </div>
      </div>

      <section className="section">
        <div className="toolbar">
          <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            {tenants.length === 0 && <option value="">Nessun tenant</option>}
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')}
          >
            <option value="day">Giorno</option>
            <option value="week">Settimana</option>
            <option value="month">Mese</option>
          </select>
          <button type="button" className="btn accent" onClick={() => void load()} disabled={!tenantId}>
            Aggiorna
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {loading && <p className="muted">Caricamento…</p>}
      </section>

      {!loading && data && currencies.length === 0 && (
        <p className="empty-state">
          Nessun movimento nel periodo selezionato per questo tenant.
        </p>
      )}

      {currencies.map((currency) => {
        const block = data!.by_currency[currency]!;
        return (
          <section key={currency} className="section">
            <h2>{currency}</h2>
            <div className="stats" style={{ marginBottom: '1rem' }}>
              <div className="stat">
                <div className="stat-label">Entrate</div>
                <div className="stat-value">{block.totals.inflow}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Uscite</div>
                <div className="stat-value">{block.totals.outflow}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Netto</div>
                <div className="stat-value">{block.totals.net}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Movimenti</div>
                <div className="stat-value">{block.totals.count}</div>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Periodo</th>
                    <th>Entrate</th>
                    <th>Uscite</th>
                    <th>Netto</th>
                    <th>N°</th>
                  </tr>
                </thead>
                <tbody>
                  {block.periods.map((p) => (
                    <tr key={p.period}>
                      <td className="mono">{p.period}</td>
                      <td>{p.inflow}</td>
                      <td>{p.outflow}</td>
                      <td>{p.net}</td>
                      <td>{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
