import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import { useDeviceStore } from '../stores/deviceStore';
import { useUiStore } from '../stores/uiStore';
import Toaster from '../components/Toaster';

/**
 * Sidebar entries, filtered by role.
 *
 * Filtering is a UX convenience only - App.jsx guards the matching routes and
 * the API re-checks every request, so hiding a link is never the security
 * control (prompt §42).
 */
const ALL_ROLES = ['admin', 'manager', 'owner', 'viewer'];

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', roles: ALL_ROLES },
  { to: '/devices', label: 'Devices', icon: '📡', roles: ALL_ROLES },
  { to: '/guide', label: 'Setup guide', icon: '📖', roles: ALL_ROLES },
  { to: '/users', label: 'Users', icon: '👥', roles: ['admin'] },
  { to: '/settings', label: 'Settings', icon: '⚙️', roles: ALL_ROLES },
];

const SOCKET_TONE = {
  online: 'ok',
  connecting: 'warn',
  offline: 'danger',
  neutral: 'neutral',
};

/**
 * Authenticated shell: navigation, connection badge, toasts, <Outlet/>.
 *
 * This is also the component that owns the realtime socket, so it is mounted
 * exactly once per session and unmounting it tears the connection down.
 */
export function AppLayout() {
  const { user, logout } = useAuth();
  const socketState = useSocket();
  const navigate = useNavigate();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebar = useUiStore((s) => s.setSidebar);
  const resetDevices = useDeviceStore((s) => s.reset);

  // A signed-in user always has a role; treat a missing one as "no access"
  // rather than showing everything.
  const visibleNav = NAV.filter((item) => item.roles.includes(user?.role));

  async function handleLogout() {
    await logout();
    resetDevices();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="icon-button topbar__menu" onClick={() => setSidebar(!sidebarOpen)} aria-label="Toggle navigation">
          ☰
        </button>

        <NavLink to="/" className="brand">
          <span className="brand__mark" aria-hidden="true">
            ◈
          </span>
          Smart Monitor
        </NavLink>

        <div className="topbar__right">
          <span className={`badge badge--${SOCKET_TONE[socketState] || 'neutral'}`} title="Realtime connection">
            {socketState === 'online' ? 'live' : socketState}
          </span>
          <span className="topbar__user" title={user?.email}>
            {user?.name || user?.email || 'Account'}
          </span>
          {user?.role && <span className="badge badge--info">{user.role}</span>}
          <button type="button" className="button button--ghost" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      <div className={`app__body ${sidebarOpen ? 'app__body--open' : ''}`.trim()}>
        <nav className="sidebar" aria-label="Main">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`.trim()}
              onClick={() => setSidebar(false)}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="content">
          <Outlet />
        </main>
      </div>

      <Toaster />
    </div>
  );
}

export default AppLayout;
