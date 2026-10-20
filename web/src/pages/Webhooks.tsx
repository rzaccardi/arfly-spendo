import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';

type Tenant = { id: string; name: string };

type Sub = {
  id: string;
  tenant_id: string;
  url: string;
  events: string[];
  status: string;
  description: string | null;
  last_delivery_at: string | null;
  last_delivery_status: string | null;
  signing_secret?: string;
};

type Delivery = {
  id: string;
  event_id: string;
  event: string;
  status: string;
  attempt_count: number;
  next_attempt_at: string | null;
  http_status: number | null;
  error_message: string | null;
  attempted_at: string | null;
  created_at: string;
};

export function WebhooksPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [selectedSub, setSelectedSub] = useState<string>('');
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [t, w] = await Promise.all([
      api<{ data: Tenant[] }>('/admin/api/tenants'),
      api<{ data: Sub[]; meta: { events: string[] } }>('/admin/api/webhooks'),
    ]);
    setTenants(t.data);
    setSubs(w.data);
    setEvents(w.meta.events);
    if (!tenantId && t.data[0]) setTenantId(t.data[0].id);
    if (selectedEvents.length === 0 && w.meta.events.length) {
      setSelectedEvents(['sync.completed', 'sync.failed']);
    }
  }

  useEffect(() => {
    void load()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function loadDeliveries(id: string) {
    setSelectedSub(id);
    const res = await api<{ data: Delivery[] }>(`/admin/api/webhooks/${id}/deliveries`);
    setDeliveries(res.data);
  }

  function toggleEvent(ev: string) {
    setSelectedEvents((prev) =>
      prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev],
    );
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setRevealedSecret(null);
    try {
      const res = await api<{ data: Sub }>('/admin/api/webhooks', {
        method: 'POST',
        json: {
          tenant_id: tenantId,
          url,
          events: selectedEvents,
          description: description || null,
        },
      });
      setRevealedSecret(res.data.signing_secret ?? null);
      setMessage('Sottoscrizione creata. Copia il signing secret ora — non verrà più mostrato.');
      setUrl('');
      setDescription('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function remove(id: string) {
    if (!confirm('Eliminare questa sottoscrizione?')) return;
    try {
      await api(`/admin/api/webhooks/${id}`, { method: 'DELETE' });
      if (selectedSub === id) {
        setSelectedSub('');
        setDeliveries([]);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function testDelivery(id: string) {
    setMessage(null);
    try {
      const res = await api<{ data: { status: string; http_status: number | null } }>(
        `/admin/api/webhooks/${id}/test`,
        { method: 'POST', json: { event: 'sync.completed', payload: { test: true } } },
      );
      setMessage(`Test: ${res.data.status} (HTTP ${res.data.http_status ?? '—'})`);
      await loadDeliveries(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  async function processPending() {
    setMessage(null);
    try {
      const res = await api<{
        data: { processed: number; succeeded: number; failed: number; dead: number };
      }>('/admin/api/webhooks/process-pending', { method: 'POST', json: { limit: 50 } });
      setMessage(
        `Worker: ${res.data.processed} processate · ${res.data.succeeded} ok · ${res.data.failed} retry · ${res.data.dead} abandoned`,
      );
      if (selectedSub) await loadDeliveries(selectedSub);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore');
    }
  }

  const tenantName = (id: string) => tenants.find((t) => t.id === id)?.name ?? id.slice(0, 8);

  if (loading) return <p className="muted">Caricamento webhook…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Webhook</h1>
          <p>Sottoscrizioni outbound firmate HMAC e consegne recenti.</p>
        </div>
        <button type="button" className="btn secondary" onClick={() => void processPending()}>
          Processa coda
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {message && <p className="muted">{message}</p>}
      {revealedSecret && (
        <div className="key-reveal" style={{ marginBottom: '1rem' }}>
          Signing secret: {revealedSecret}
        </div>
      )}

      <section className="section">
        <h2>Nuova sottoscrizione</h2>
        {tenants.length === 0 ? (
          <p className="empty-state">Nessun tenant disponibile. Crea un tenant prima.</p>
        ) : (
          <form onSubmit={(e) => void create(e)} className="form-grid">
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
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>URL HTTPS</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                required
              />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Descrizione</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Opzionale"
              />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Eventi</label>
              <div className="chip-row">
                {events.map((ev) => (
                  <label key={ev} className={`chip ${selectedEvents.includes(ev) ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedEvents.includes(ev)}
                      onChange={() => toggleEvent(ev)}
                    />
                    {ev}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ alignSelf: 'end' }}>
              <button
                className="btn accent"
                type="submit"
                disabled={!url || selectedEvents.length === 0}
              >
                Crea
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="section">
        <h2>Sottoscrizioni</h2>
        {subs.length === 0 ? (
          <p className="empty-state">
            Nessuna sottoscrizione. Crea un endpoint HTTPS e seleziona gli eventi da ricevere.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>URL</th>
                  <th>Eventi</th>
                  <th>Stato</th>
                  <th>Ultima consegna</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id}>
                    <td>{tenantName(s.tenant_id)}</td>
                    <td className="mono">{s.url}</td>
                    <td className="muted">{s.events.join(', ')}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td>
                      {s.last_delivery_status ? (
                        <>
                          <StatusBadge status={s.last_delivery_status} />{' '}
                          <span className="muted">
                            {s.last_delivery_at
                              ? new Date(s.last_delivery_at).toLocaleString('it-IT')
                              : ''}
                          </span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => void loadDeliveries(s.id)}
                        >
                          Consegne
                        </button>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() => void testDelivery(s.id)}
                        >
                          Test
                        </button>
                        <button
                          type="button"
                          className="btn danger"
                          onClick={() => void remove(s.id)}
                        >
                          Elimina
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedSub && (
        <section className="section">
          <h2>Consegne recenti</h2>
          {deliveries.length === 0 ? (
            <p className="empty-state">Nessuna consegna per questa sottoscrizione.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Event ID</th>
                    <th>Stato</th>
                    <th>Tentativi</th>
                    <th>HTTP</th>
                    <th>Quando</th>
                    <th>Errore</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id}>
                      <td>{d.event}</td>
                      <td className="mono">{d.event_id.slice(0, 16)}…</td>
                      <td>
                        <StatusBadge status={d.status} />
                      </td>
                      <td>{d.attempt_count}</td>
                      <td>{d.http_status ?? '—'}</td>
                      <td>
                        {d.attempted_at
                          ? new Date(d.attempted_at).toLocaleString('it-IT')
                          : new Date(d.created_at).toLocaleString('it-IT')}
                      </td>
                      <td className="muted">{d.error_message ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
