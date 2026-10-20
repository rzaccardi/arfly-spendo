import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';

type Tenant = {
  id: string;
  name: string;
  legal_name: string | null;
  vat_number: string | null;
  status: string;
  account_count: number;
  connections: Array<{
    id: string;
    workspace_id: string;
    status: string;
    last_sync_at: string | null;
    last_error: string | null;
  }>;
};

const emptyForm = { name: '', legal_name: '', vat_number: '', status: 'active' };

export function TenantsPage() {
  const [rows, setRows] = useState<Tenant[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await api<{ data: Tenant[] }>('/admin/api/tenants');
    setRows(res.data);
  }

  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        legal_name: form.legal_name || null,
        vat_number: form.vat_number || null,
        status: form.status,
      };
      if (editing) {
        await api(`/admin/api/tenants/${editing}`, { method: 'PATCH', json: payload });
      } else {
        await api('/admin/api/tenants', { method: 'POST', json: payload });
      }
      setForm(emptyForm);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(t: Tenant) {
    setEditing(t.id);
    setForm({
      name: t.name,
      legal_name: t.legal_name ?? '',
      vat_number: t.vat_number ?? '',
      status: t.status,
    });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tenant</h1>
          <p>Aziende / workspace collegati a Spendo.</p>
        </div>
      </div>

      <section className="section">
        <h2>{editing ? 'Modifica tenant' : 'Nuovo tenant'}</h2>
        <form onSubmit={(e) => void onSubmit(e)} className="form-grid">
          <div className="field">
            <label>Nome</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label>Ragione sociale</label>
            <input
              value={form.legal_name}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>P. IVA</label>
            <input
              value={form.vat_number}
              onChange={(e) => setForm({ ...form, vat_number: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Stato</label>
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
          </div>
          <div style={{ alignSelf: 'end', display: 'flex', gap: '0.5rem' }}>
            <button className="btn accent" type="submit" disabled={busy}>
              {editing ? 'Salva' : 'Crea'}
            </button>
            {editing && (
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setEditing(null);
                  setForm(emptyForm);
                }}
              >
                Annulla
              </button>
            )}
          </div>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="section">
        <h2>Elenco</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>P. IVA</th>
                <th>Stato</th>
                <th>Conti</th>
                <th>Connessioni</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    {t.legal_name && <div className="muted">{t.legal_name}</div>}
                  </td>
                  <td>{t.vat_number ?? '—'}</td>
                  <td>
                    <span className={`badge ${t.status === 'active' ? 'ok' : 'warn'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td>{t.account_count}</td>
                  <td>
                    {t.connections.length === 0
                      ? '—'
                      : t.connections.map((c) => (
                          <div key={c.id} className="mono">
                            {c.workspace_id}{' '}
                            <span className={`badge ${c.status === 'active' ? 'ok' : 'warn'}`}>
                              {c.status}
                            </span>
                          </div>
                        ))}
                  </td>
                  <td>
                    <button type="button" className="btn secondary" onClick={() => startEdit(t)}>
                      Modifica
                    </button>
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
