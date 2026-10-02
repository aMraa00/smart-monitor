import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuthBootstrap, useAuth } from './hooks/useAuth';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import DashboardPage from './pages/Dashboard';
import DevicesPage from './pages/Devices';
import DeviceDetailPage from './pages/DeviceDetail';
import SettingsPage from './pages/Settings';
import UsersPage from './pages/Users';
import GuidePage from './pages/Guide';
import EmptyState from './components/EmptyState';
import { Spinner } from './components/Spinner';

/** Full-screen loader used while the session is being restored. */
function BootSplash() {
  return (
    <div className="boot">
      <Spinner size={28} />
      <span>Restoring session…</span>
    </div>
  );
}

/**
 * Route guard.
 *
 * Authorisation is never taken from the frontend: this guard only decides what
 * to SHOW. Every protected request is re-checked by the API with a JWT, so a
 * tampered client gains nothing (prompt §42).
 */
function RequireAuth({ children }) {
  const ready = useAuthBootstrap();
  const { user } = useAuth();

  if (!ready) return <BootSplash />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/**
 * Role guard: hides a page the current role may not use.
 *
 * This is presentation only. The API re-checks every request with
 * `requireRole(...)`, so editing the client gains an attacker nothing
 * (prompt §42). Without it an owner typing /users by hand would only see a
 * 403 after the page already fired its requests.
 */
function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!user) return null;
  if (roles.includes(user.role)) return children;

  return (
    <EmptyState
      icon="🔒"
      title="Admins only"
      hint={`Your role is "${user.role}". Ask an administrator to change it if you need this page.`}
    />
  );
}

/** Keeps a signed-in user away from the login/register screens. */
function PublicOnly({ children }) {
  const ready = useAuthBootstrap();
  const { user } = useAuth();

  if (!ready) return <BootSplash />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <LoginPage />
            </PublicOnly>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnly>
              <RegisterPage />
            </PublicOnly>
          }
        />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="devices" element={<DevicesPage />} />
          <Route path="devices/:deviceId" element={<DeviceDetailPage />} />
          <Route path="guide" element={<GuidePage />} />
          <Route
            path="users"
            element={
              <RequireRole roles={['admin']}>
                <UsersPage />
              </RequireRole>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
