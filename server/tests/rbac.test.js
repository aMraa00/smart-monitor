'use strict';

/**
 * RBAC (FR-A4): role boundaries across the HTTP layer.
 *
 * What must hold, regardless of what the frontend shows:
 *   - only an admin manages accounts
 *   - a manager reads the whole fleet but never destroys a station
 *   - an owner never sees another owner's device (404, never 403 - no enumeration)
 *   - the first privileged account can only be bootstrapped from the server
 *     environment, never from a request body
 */

const h = require('./helpers/harness');
const authService = require('../src/services/auth.service');
const { User } = require('../src/models');

beforeAll(async () => {
  await h.connectDb();
});

afterEach(async () => {
  await h.resetDb();
});

afterAll(async () => {
  await h.closeDb();
});

/** An owner with one claimed device. */
async function ownerWithDevice() {
  const owner = await h.registerUser();
  const provisioned = await h.provisionDevice({ capabilities: ['temperature'] });
  const device = await h.claimDevice(owner.accessToken, provisioned.deviceId, provisioned.claimCode);
  return { owner, device };
}

/**
 * Perform an authenticated request.
 *
 * `agent()` returns `request(app)`, which is a superagent builder: the HTTP
 * verb must be called first and only the resulting Test object has `.set()`.
 * This helper hides that ordering so a test reads as `as(token).get(url)`.
 *
 * @example await as(owner.accessToken).post('/api/v1/devices', { ... }).expect(201)
 */
function as(token) {
  const call = (verb) => (url) => h.agent()[verb](url).set('Authorization', `Bearer ${token}`);
  return {
    get: call('get'),
    post: call('post'),
    patch: call('patch'),
    put: call('put'),
    delete: call('delete'),
  };
}

describe('admin user management', () => {
  it('lets an admin create a manager and lists accounts', async () => {
    const admin = await h.createUserWithRole('admin');

    const created = await as(admin.accessToken)
      .post('/api/v1/auth/users')
      .send({ email: 'mgr@example.com', password: 'Str0ng!Passw0rd', role: 'manager' })
      .expect(201);

    expect(created.body.data.user.role).toBe('manager');
    // A newly created account must never come back pre-authenticated.
    expect(created.body.data.accessToken).toBeUndefined();
    expect(created.body.data.refreshToken).toBeUndefined();

    const listed = await as(admin.accessToken).get('/api/v1/auth/users').expect(200);

    expect(listed.body.data.map((u) => u.email)).toContain('mgr@example.com');
    expect(listed.body.meta.total).toBeGreaterThanOrEqual(2);
    // Hashes and lock state must never leak through the admin listing.
    expect(listed.body.data[0].passwordHash).toBeUndefined();
    expect(listed.body.data[0].lockedUntil).toBeUndefined();
  });

  it('lets the new account sign in on its own with the assigned password', async () => {
    const admin = await h.createUserWithRole('admin');
    await as(admin.accessToken)
      .post('/api/v1/auth/users')
      .send({ email: 'newmgr@example.com', password: 'Str0ng!Passw0rd', role: 'manager' })
      .expect(201);

    const login = await h
      .agent()
      .post('/api/v1/auth/login')
      .send({ email: 'newmgr@example.com', password: 'Str0ng!Passw0rd' })
      .expect(200);

    expect(login.body.data.user.role).toBe('manager');
  });

  it('rejects a duplicate account with 409 and an unknown role with 422', async () => {
    const admin = await h.createUserWithRole('admin');

    await as(admin.accessToken)
      .post('/api/v1/auth/users')
      .send({ email: 'dup@example.com', password: 'Str0ng!Passw0rd', role: 'owner' })
      .expect(201);

    await as(admin.accessToken)
      .post('/api/v1/auth/users')
      .send({ email: 'dup@example.com', password: 'Str0ng!Passw0rd', role: 'owner' })
      .expect(409);

    await as(admin.accessToken)
      .post('/api/v1/auth/users')
      .send({ email: 'weird@example.com', password: 'Str0ng!Passw0rd', role: 'superuser' })
      .expect(422);
  });

  it('filters the listing by role', async () => {
    const admin = await h.createUserWithRole('admin');
    await h.createUserWithRole('manager');

    const listed = await as(admin.accessToken).get('/api/v1/auth/users?role=manager').expect(200);

    expect(listed.body.data.length).toBeGreaterThan(0);
    expect(listed.body.data.every((u) => u.role === 'manager')).toBe(true);
  });

  it('blocks managers and owners from creating or listing users (403)', async () => {
    const manager = await h.createUserWithRole('manager');
    const owner = await h.registerUser();

    await as(manager.accessToken)
      .post('/api/v1/auth/users')
      .send({ email: 'x@example.com', password: 'Str0ng!Passw0rd', role: 'owner' })
      .expect(403);

    await as(owner.accessToken)
      .post('/api/v1/auth/users')
      .send({ email: 'y@example.com', password: 'Str0ng!Passw0rd', role: 'owner' })
      .expect(403);

    await as(owner.accessToken).get('/api/v1/auth/users').expect(403);
  });

  it('requires authentication for account management', async () => {
    await h.agent().get('/api/v1/auth/users').expect(401);
    await h
      .agent()
      .post('/api/v1/auth/users')
      .send({ email: 'a@b.co', password: 'Str0ng!Passw0rd' })
      .expect(401);
  });
});

describe('privileged fleet access', () => {
  it('lets a manager read and configure an owner device but never destroy it', async () => {
    const { device } = await ownerWithDevice();
    const manager = await h.createUserWithRole('manager');

    await as(manager.accessToken).get(`/api/v1/devices/${device.deviceId}`).expect(200);

    await as(manager.accessToken)
      .patch(`/api/v1/devices/${device.deviceId}`)
      .send({ displayName: 'Renamed by fleet manager' })
      .expect(200);

    await as(manager.accessToken).post(`/api/v1/devices/${device.deviceId}/revoke`).expect(403);
    await as(manager.accessToken).delete(`/api/v1/devices/${device.deviceId}`).expect(403);
  });

  it('lets an admin read and destroy any device', async () => {
    const { device } = await ownerWithDevice();
    const admin = await h.createUserWithRole('admin');

    await as(admin.accessToken).get(`/api/v1/devices/${device.deviceId}`).expect(200);
    await as(admin.accessToken).post(`/api/v1/devices/${device.deviceId}/revoke`).expect(200);
  });

  it('shows managers the whole fleet while owners see only their own', async () => {
    await ownerWithDevice();
    const manager = await h.createUserWithRole('manager');
    const other = await h.registerUser();

    const managerList = await as(manager.accessToken).get('/api/v1/devices').expect(200);
    const otherList = await as(other.accessToken).get('/api/v1/devices').expect(200);

    expect(managerList.body.meta.total).toBe(1);
    expect(otherList.body.meta.total).toBe(0);
  });

  it('hides another owner device behind 404, never 403 (no enumeration)', async () => {
    const { device } = await ownerWithDevice();
    const stranger = await h.registerUser();

    const response = await as(stranger.accessToken).get(`/api/v1/devices/${device.deviceId}`).expect(404);
    expect(response.body.error.code).toBe('DEVICE_NOT_FOUND');
  });

  it('keeps a viewer out of destructive routes even on its own device', async () => {
    const owner = await h.registerUser();
    const provisioned = await h.provisionDevice({ capabilities: ['temperature'] });
    const device = await h.claimDevice(owner.accessToken, provisioned.deviceId, provisioned.claimCode);

    // A viewer claims nothing itself, so it must be refused on someone else's
    // device with the same 404 (not 403) used for every non-owner.
    const viewer = await h.createUserWithRole('viewer');
    const forbidden = await as(viewer.accessToken).get(`/api/v1/devices/${device.deviceId}`).expect(404);
    expect(forbidden.body.error.code).toBe('DEVICE_NOT_FOUND');

    // And a viewer that DOES own a device still cannot revoke or delete it.
    const own = await h.provisionDevice({ capabilities: ['temperature'] });
    const owned = await h.claimDevice(viewer.accessToken, own.deviceId, own.claimCode);

    await as(viewer.accessToken).get(`/api/v1/devices/${owned.deviceId}`).expect(200);
    await as(viewer.accessToken).post(`/api/v1/devices/${owned.deviceId}/revoke`).expect(403);
    await as(viewer.accessToken).delete(`/api/v1/devices/${owned.deviceId}`).expect(403);
  });
});

describe('role changes take effect immediately', () => {
  it('stops serving privileged reads once an account is downgraded', async () => {
    const { device } = await ownerWithDevice();
    const manager = await h.createUserWithRole('manager');

    await as(manager.accessToken).get(`/api/v1/devices/${device.deviceId}`).expect(200);

    await User.updateOne({ email: manager.email }, { role: 'owner' });

    // The role is re-read from the database on every request, so the already
    // issued access token loses the privilege immediately (threat T17).
    await as(manager.accessToken).get(`/api/v1/devices/${device.deviceId}`).expect(404);
  });
});

describe('bootstrap accounts', () => {
  it('creates the first admin/manager from the environment and is idempotent', async () => {
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: 'Admin@Example.com', // normalisation is applied
      BOOTSTRAP_ADMIN_PASSWORD: 'Str0ng!Passw0rd',
      BOOTSTRAP_MANAGER_EMAIL: 'mgr@example.com',
      BOOTSTRAP_MANAGER_PASSWORD: 'Str0ng!Passw0rd',
    };

    const first = await authService.ensureBootstrapAccounts(env);
    expect(first).toEqual([
      { email: 'admin@example.com', role: 'admin', action: 'created' },
      { email: 'mgr@example.com', role: 'manager', action: 'created' },
    ]);

    // Re-running must not duplicate the accounts.
    const second = await authService.ensureBootstrapAccounts(env);
    expect(second.every((account) => account.action === 'unchanged')).toBe(true);

    const login = await h
      .agent()
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'Str0ng!Passw0rd' })
      .expect(200);
    expect(login.body.data.user.role).toBe('admin');

    const listed = await as(login.body.data.accessToken).get('/api/v1/auth/users').expect(200);
    expect(listed.body.data.map((u) => u.email)).toContain('mgr@example.com');
  });

  it('repairs a drifted role but leaves the existing password alone', async () => {
    const env = {
      BOOTSTRAP_ADMIN_EMAIL: 'root@example.com',
      BOOTSTRAP_ADMIN_PASSWORD: 'Str0ng!Passw0rd',
    };

    await h.registerUser({ email: 'root@example.com', password: 'Different!Passw0rd' });

    const applied = await authService.ensureBootstrapAccounts(env);
    expect(applied).toEqual([{ email: 'root@example.com', role: 'admin', action: 'promoted' }]);
    expect((await User.findOne({ email: 'root@example.com' })).role).toBe('admin');

    // Promotion must never silently reset somebody's password.
    await h
      .agent()
      .post('/api/v1/auth/login')
      .send({ email: 'root@example.com', password: 'Different!Passw0rd' })
      .expect(200);
  });

  it('skips half-configured pairs (email without password)', async () => {
    const applied = await authService.ensureBootstrapAccounts({
      BOOTSTRAP_ADMIN_EMAIL: 'half@example.com', // no password -> unusable
    });

    expect(applied).toEqual([]);
    expect(await User.countDocuments({ email: 'half@example.com' })).toBe(0);
  });
});
