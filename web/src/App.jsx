import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuthBootstrap, useAuth } from './hooks/useAuth';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import DashboardPage from './pages/Dashboard';
import DevicesPage from './pages/Devices';
import DeviceDetailPage from './pages/DeviceDetail';
import SettingsPage from './pages/Settings';
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
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
