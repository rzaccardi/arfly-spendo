import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';

const links = [
  { to: '/', label: 'Panoramica', end: true },
  { to: '/tenants', label: 'Tenant' },
  { to: '/applications', label: 'Applicazioni' },
  { to: '/connections', label: 'Connessioni' },
  { to: '/sync-jobs', label: 'Sync job' },
  { to: '/cashflow', label: 'Flusso di cassa' },
  { to: '/webhooks', label: 'Webhook' },
  { to: '/audit', label: 'Audit log' },
  { to: '/data', label: 'Conti & movimenti' },
];

export function Layout() {
  const { logout } = useAuth();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-name">Spendo</div>
          <div className="brand-tag">Admin · arfly</div>
        </div>
        <nav className="nav">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button type="button" className="btn ghost" onClick={() => void logout()}>
            Esci
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
