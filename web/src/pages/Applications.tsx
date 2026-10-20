import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';

type AppRow = {
  id: string;
  name: string;
  status: string;
  key_prefix: string | null;
  last_used_at: string | null;
  credential_status: string;
  permissions: Array<{ tenant_id: string; permissions: string[] }>;
};

type Tenant = { id: string; name: string };

const PERMS = ['accounts:read', 'balances:read', 'transactions:read', 'sync:request'];

export function ApplicationsPage() {
  const [rows, setRows] = useState<AppRow[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [name, setName] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [permApp, setPermApp] = useState<string | null>(null);
  const [permTenant, setPermTenant] = useState('');
  const [permList, setPermList] = useState<string[]>([...PERMS]);

  async function load() {
    const [apps, t] = await Promise.all([
      api<{ data: AppRow[] }>('/admin/api/applications'),
      api<{ data: Tenant[] }>('/admin/api/tenants'),
    ]);
    setRows(apps.data);
    setTenants(t.data);
  }

  useEffect(() => {
    void load().catch((e: Error) => setError(e.message));
  }, []);

  async function createApp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api<{ data: { api_key: string } }>('/admin/api/applications', {
        method: 'POST',
        json: {
          name,
          tenant_id: tenantId || undefined,
          permissions: PERMS,
        },
      });
      setRevealedKey(res.data.api_key);
      setName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function rotate(id: string) {
    if (!confirm('Ruotare la API key? La chiave precedente verrà revocata.')) return;
    try {
      const res = await api<{ data: { api_key: string } }>(
        `/admin/api/applications/${id}/rotate-key`,
        { method: 'POST' },
      );
      setRevealedKey(res.data.api_key);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revocare tutte le credenziali di questa app?')) return;
    try {
      await api(`/admin/api/applications/${id}/revoke`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function savePerms(e: FormEvent) {
    e.preventDefault();
    if (!permApp || !permTenant) return;
    try {
      await api(`/admin/api/applications/${permApp}/permissions`, {
        method: 'PUT',
        json: { tenant_id: permTenant, permissions: permList },
      });
      setPermApp(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Applicazioni</h1>
          <p>App SaaS e chiavi Spendo (spk_). La chiave in chiaro appare solo a creazione/rotazione.</p>
        </div>
      </div>

      <section className="section">
        <h2>Nuova applicazione</h2>
        <form onSubmit={(e) => void createApp(e)} className="form-grid">
          <div className="field">
            <label>Nome</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Tenant iniziale (opz.)</label>
            <select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              <option value="">—</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn accent" type="submit">
              Crea + genera key
            </button>
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
                <th>Prefisso key</th>
                <th>Credenziali</th>
                <th>Ultimo uso</th>
                <th>Permessi</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong>{a.name}</strong>
                    <div className="muted mono">{a.id.slice(0, 8)}…</div>
                  </td>
                  <td className="mono">{a.key_prefix ?? '—'}</td>
                  <td>
                    <span className={`badge ${a.credential_status === 'active' ? 'ok' : 'warn'}`}>
                      {a.credential_status}
                    </span>
                  </td>
                  <td>
                    {a.last_used_at
                      ? new Date(a.last_used_at).toLocaleString('it-IT')
                      : '—'}
                  </td>
                  <td>
                    {a.permissions.length === 0
                      ? '—'
                      : a.permissions.map((p) => (
                          <div key={p.tenant_id} className="muted">
                            {p.tenant_id.slice(0, 8)}… · {p.permissions.join(', ')}
                          </div>
                        ))}
                  </td>
                  <td>
                    <div className="inline-actions">
                      <button type="button" className="btn secondary" onClick={() => void rotate(a.id)}>
                        Ruota key
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => {
                          setPermApp(a.id);
                          setPermTenant(a.permissions[0]?.tenant_id ?? tenants[0]?.id ?? '');
                          setPermList(a.permissions[0]?.permissions ?? [...PERMS]);
                        }}
                      >
                        Permessi
                      </button>
                      <button type="button" className="btn danger" onClick={() => void revoke(a.id)}>
                        Revoca
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {revealedKey && (
        <div className="modal-backdrop" onClick={() => setRevealedKey(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>API key — salvala ora</h2>
            <p className="muted">Non verrà più mostrata in chiaro.</p>
            <div className="key-reveal">{revealedKey}</div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => void navigator.clipboard.writeText(revealedKey)}
              >
                Copia
              </button>
              <button type="button" className="btn accent" onClick={() => setRevealedKey(null)}>
                Ho salvato
              </button>
            </div>
          </div>
        </div>
      )}

      {permApp && (
        <div className="modal-backdrop" onClick={() => setPermApp(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Assegna permessi tenant</h2>
            <form onSubmit={(e) => void savePerms(e)}>
              <div className="field">
                <label>Tenant</label>
                <select value={permTenant} onChange={(e) => setPermTenant(e.target.value)} required>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Permessi</label>
                {PERMS.map((p) => (
                  <label key={p} style={{ display: 'flex', gap: '0.4rem', fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={permList.includes(p)}
                      onChange={(e) => {
                        setPermList((prev) =>
                          e.target.checked ? [...prev, p] : prev.filter((x) => x !== p),
                        );
                      }}
                    />
                    {p}
                  </label>
                ))}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={() => setPermApp(null)}>
                  Annulla
                </button>
                <button type="submit" className="btn accent">
                  Salva
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
