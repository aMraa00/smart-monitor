import Card from '../components/Card';
import Badge from '../components/Badge';
import { useAuth } from '../hooks/useAuth';
import { useDeviceStore } from '../stores/deviceStore';

/** Accent per role, shared by the settings badge and the top bar. */
const ROLE_TONE = { admin: 'info', manager: 'warn', owner: 'neutral', viewer: 'neutral' };

/**
 * Account surface.
 *
 * Deliberately minimal in V1: the product has no profile editing endpoint, so
 * this page only reports what the server knows and offers session actions.
 */
export function SettingsPage() {
  const { user, logout } = useAuth();
  const resetDevices = useDeviceStore((s) => s.reset);

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Account and session</p>
        </div>
      </header>

      <Card title="Profile">
        <dl className="detail-list">
          <div>
            <dt>Name</dt>
            <dd>{user?.name || '—'}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user?.email || '—'}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>
              <Badge tone={ROLE_TONE[user?.role] || 'neutral'}>{user?.role || 'owner'}</Badge>
            </dd>
          </div>
        </dl>
      </Card>

      <Card title="Session" subtitle="Signing out invalidates the refresh token on the server too.">
        <button
          type="button"
          className="button button--danger"
          onClick={async () => {
            await logout();
            resetDevices();
            window.location.assign('/login');
          }}
        >
          Sign out everywhere
        </button>
      </Card>
    </>
  );
}

export default SettingsPage;
