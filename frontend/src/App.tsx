import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppLayout } from './components/AppLayout';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { MonitorDetailPage } from './pages/MonitorDetailPage';
import { EditMonitorPage, NewMonitorPage } from './pages/MonitorFormPage';
import { PublicStatusPage } from './pages/PublicStatusPage';
import { StatusPageSettingsPage } from './pages/StatusPageSettingsPage';

/** Sends signed-out visitors to /login, remembering where they were going. */
function RequireAuth() {
  const { user } = useAuth();
  const location = useLocation();
  if (user === undefined) return <p className="um-splash">Loading…</p>;
  if (user === null) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/status/:slug" element={<PublicStatusPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="monitors/new" element={<NewMonitorPage />} />
          <Route path="monitors/:id" element={<MonitorDetailPage />} />
          <Route path="monitors/:id/edit" element={<EditMonitorPage />} />
          <Route path="status-page" element={<StatusPageSettingsPage />} />
        </Route>
      </Route>

      <Route
        path="*"
        element={
          <div className="um-empty">
            <h1>Page not found</h1>
            <Link to="/" className="um-btn um-btn--primary">
              Go to monitors
            </Link>
          </div>
        }
      />
    </Routes>
  );
}
