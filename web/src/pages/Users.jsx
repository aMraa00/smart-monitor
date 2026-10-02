import { useCallback, useEffect, useState } from 'react';
import Card from '../components/Card';
import Badge from '../components/Badge';
import EmptyState from '../components/EmptyState';
import { LoadingBlock } from '../components/Spinner';
import { listUsers, createUser } from '../api/auth';
import { useUiStore } from '../stores/uiStore';

/** Accent per role, mirroring Settings.jsx. */
const ROLE_TONE = { admin: 'info', manager: 'warn', owner: 'neutral', viewer: 'neutral' };

/**
 * Admin-only account management.
 *
 * Server-side `requireRole('admin')` backs every call: a manager or owner who
 * navigates here by hand gets a 403 that we render as an explanatory empty
 * state instead of crashing.
 */
export function UsersPage() {
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const toast = useUiStore((s) => s.toast);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { users: items, meta: pageMeta } = await listUsers({ limit: 100 });
      setUsers(items);
      setMeta(pageMeta);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(payload) {
    setCreating(true);
    try {
      const created = await createUser(payload);
      setUsers((prev) => [created, ...prev]);
      toast(`Created ${created.email} (${created.role})`, 'ok');
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p className="muted">
            Admin only · {meta?.total ?? users.length} account{(meta?.total ?? users.length) === 1 ? '' : 's'}
          </p>
        </div>
      </header>

      {error && <p className="form__error">{error.message || 'Failed to load users'}</p>}
      {loading ? (
        <LoadingBlock label="Loading users" />
      ) : (
        <>
          <UserCreateForm onCreate={handleCreate} creating={creating} />
          <Card title="Accounts" subtitle="Password hashes and lock state are never exposed by the API.">
            {users.length === 0 ? (
              <EmptyState icon="👥" title="No accounts yet" hint="Create the first manager or owner above." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>{u.name || '—'}</td>
                      <td>
                        <Badge tone={ROLE_TONE[u.role] || 'neutral'}>{u.role}</Badge>
                      </td>
                      <td className="muted">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </>
  );
}

function UserCreateForm({ onCreate, creating }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('owner');
  const [message, setMessage] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setMessage(null);
    try {
      await onCreate({ email: email.trim(), password, name: name.trim(), role });
      setEmail('');
      setName('');
      setPassword('');
      setRole('owner');
      setMessage({ tone: 'ok', text: 'Account created.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: err.message || 'Create failed' });
    }
  }

  return (
    <Card title="Create account" subtitle="Only admins can reach this form — the API re-checks on every request.">
      <form className="form" onSubmit={submit}>
        <div className="form__grid">
          <label className="field">
            <span>Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="manager@example.com" />
          </label>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Fleet Manager" />
          </label>
          <label className="field">
            <span>Temporary password (min 8 chars)</span>
            <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="field">
            <span>Role</span>
            <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="owner">owner — owns their own stations</option>
              <option value="manager">manager — reads the whole fleet</option>
              <option value="admin">admin — full access</option>
            </select>
          </label>
        </div>
        {message && <p className={`form__${message.tone === 'ok' ? 'success' : 'error'}`}>{message.text}</p>}
        <button type="submit" className="button button--primary" disabled={creating}>
          {creating ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </Card>
  );
}

export default UsersPage;