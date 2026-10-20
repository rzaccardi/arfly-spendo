import { useEffect, useState } from 'react';
import { api } from '../api';

type Account = {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  name: string;
  iban: string | null;
  currency: string;
  status: string;
};

type Tx = {
  id: string;
  tenant_id: string;
  bank_account_id: string;
  booking_date: string;
  amount: string;
  currency: string;
  description: string | null;
  counterparty_name: string | null;
  status: string;
};

type Tenant = { id: string; name: string };

export function DataBrowsePage() {
  const [tab, setTab] = useState<'accounts' | 'tx'>('tx');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [q, setQ] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ data: Tenant[] }>('/admin/api/tenants')
      .then((r) => setTenants(r.data))
      .catch((e: Error) => setError(e.message));
  }, []);

  async function loadAccounts() {
    const qs = new URLSearchParams();
    if (tenantId) qs.set('tenant_id', tenantId);
    const res = await api<{ data: Account[] }>(`/admin/api/accounts?${qs}`);
    setAccounts(res.data);
  }

  async function loadTx() {
    const qs = new URLSearchParams();
    if (tenantId) qs.set('tenant_id', tenantId);
    if (q) qs.set('q', q);
    if (dateFrom) qs.set('date_from', dateFrom);
    if (dateTo) qs.set('date_to', dateTo);
    if (minAmount) qs.set('min_amount', minAmount);
    if (maxAmount) qs.set('max_amount', maxAmount);
    qs.set('limit', '100');
    const res = await api<{ data: Tx[] }>(`/admin/api/transactions?${qs}`);
    setTxs(res.data);
  }

  useEffect(() => {
    void (tab === 'accounts' ? loadAccounts() : loadTx()).catch((e: Error) =>
      setError(e.message),
    );
  }, [tab]);

  async function exportCsv() {
    const qs = new URLSearchParams();
    if (tenantId) qs.set('tenant_id', tenantId);
    if (q) qs.set('q', q);
    if (dateFrom) qs.set('date_from', dateFrom);
    if (dateTo) qs.set('date_to', dateTo);
    if (minAmount) qs.set('min_amount', minAmount);
    if (maxAmount) qs.set('max_amount', maxAmount);
    qs.set('format', 'csv');
    const csv = await api<string>(`/admin/api/transactions?${qs}`);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spendo-transactions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Conti & movimenti</h1>
          <p>Esplorazione read-only cross-tenant con filtri avanzati ed export CSV.</p>
        </div>
        <div className="toolbar">
          <button
            type="button"
            className={`btn ${tab === 'accounts' ? 'accent' : 'secondary'}`}
            onClick={() => setTab('accounts')}
          >
            Conti
          </button>
          <button
            type="button"
            className={`btn ${tab === 'tx' ? 'accent' : 'secondary'}`}
            onClick={() => setTab('tx')}
          >
            Movimenti
          </button>
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
        {tab === 'tx' && (
          <>
            <input placeholder="Cerca (q)…" value={q} onChange={(e) => setQ(e.target.value)} />
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <input
              placeholder="Importo min"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              style={{ width: 110 }}
            />
            <input
              placeholder="Importo max"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              style={{ width: 110 }}
            />
          </>
        )}
        <button
          type="button"
          className="btn secondary"
          onClick={() =>
            void (tab === 'accounts' ? loadAccounts() : loadTx()).catch((e: Error) =>
              setError(e.message),
            )
          }
        >
          Applica
        </button>
        {tab === 'tx' && (
          <button type="button" className="btn accent" onClick={() => void exportCsv()}>
            Export CSV
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      {tab === 'accounts' ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Nome</th>
                <th>IBAN</th>
                <th>Valuta</th>
                <th>Stato</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.tenant_name ?? a.tenant_id.slice(0, 8)}</td>
                  <td>{a.name}</td>
                  <td className="mono">{a.iban ?? '—'}</td>
                  <td>{a.currency}</td>
                  <td>
                    <span className={`badge ${a.status === 'active' ? 'ok' : 'warn'}`}>
                      {a.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Importo</th>
                <th>Descrizione</th>
                <th>Controparte</th>
                <th>Stato</th>
                <th>Tenant</th>
              </tr>
            </thead>
            <tbody>
              {txs.map((t) => (
                <tr key={t.id}>
                  <td>{t.booking_date}</td>
                  <td className="mono">
                    {t.amount} {t.currency}
                  </td>
                  <td>{t.description ?? '—'}</td>
                  <td>{t.counterparty_name ?? '—'}</td>
                  <td>{t.status}</td>
                  <td className="mono">{t.tenant_id.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
