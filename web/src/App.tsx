import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { TenantsPage } from './pages/Tenants';
import { ApplicationsPage } from './pages/Applications';
import { ConnectionsPage } from './pages/Connections';
import { SyncJobsPage } from './pages/SyncJobs';
import { AuditLogsPage } from './pages/AuditLogs';
import { DataBrowsePage } from './pages/DataBrowse';
import { WebhooksPage } from './pages/Webhooks';
import { CashflowPage } from './pages/Cashflow';

function Protected({ children }: { children: React.ReactNode }) {
  const { loading, authenticated } = useAuth();
  if (loading) {
    return (
      <div className="login-page">
        <p className="muted">Caricamento…</p>
      </div>
    );
  }
  if (!authenticated) return <Navigate to="/login" replace />;
  return children;
}

export function App() {
  const { authenticated, loading } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={
          loading ? (
            <div className="login-page">
              <p className="muted">Caricamento…</p>
            </div>
          ) : authenticated ? (
            <Navigate to="/" replace />
          ) : (
            <LoginPage />
          )
        }
      />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="tenants" element={<TenantsPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="connections" element={<ConnectionsPage />} />
        <Route path="sync-jobs" element={<SyncJobsPage />} />
        <Route path="audit" element={<AuditLogsPage />} />
        <Route path="data" element={<DataBrowsePage />} />
        <Route path="webhooks" element={<WebhooksPage />} />
        <Route path="cashflow" element={<CashflowPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
