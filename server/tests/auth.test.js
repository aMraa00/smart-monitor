'use strict';

/**
 * FR-A: accounts, JWT, refresh rotation with reuse detection, RBAC.
 */

const h = require('./helpers/harness');

beforeAll(async () => {
  await h.connectDb();
});

afterEach(async () => {
  await h.resetDb();
});

afterAll(async () => {
  await h.closeDb();
});

describe('POST /api/v1/auth/register', () => {
  it('creates an account and returns a token pair', async () => {
    const response = await h
      .agent()
      .post('/api/v1/auth/register')
      .send({ email: 'owner@example.com', password: 'Str0ng!Passw0rd', name: 'Owner' })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe('owner@example.com');
    expect(response.body.data.user.role).toBe('owner');
    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).toEqual(expect.any(String));
    // The hash must never leak.
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects a duplicate email', async () => {
    await h.registerUser({ email: 'dup@example.com' });
    const response = await h
      .agent()
      .post('/api/v1/auth/register')
      .send({ email: 'dup@example.com', password: 'Str0ng!Passw0rd' })
      .expect(409);

    expect(response.body.error.code).toBe('AUTH_EMAIL_TAKEN');
  });

  it('rejects a weak password and a malformed email (422)', async () => {
    const weak = await h
      .agent()
      .post('/api/v1/auth/register')
      .send({ email: 'x@example.com', password: 'short' })
      .expect(422);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');

    await h
      .agent()
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'Str0ng!Passw0rd' })
      .expect(422);
  });

  it('ignores a client supplied role (privilege escalation blocked)', async () => {
    const response = await h
      .agent()
      .post('/api/v1/auth/register')
      .send({ email: 'evil@example.com', password: 'Str0ng!Passw0rd', role: 'admin' })
      .expect(201);

    expect(response.body.data.user.role).toBe('owner');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const { email, password } = await h.registerUser();
    const response = await h
      .agent()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);

    expect(response.body.data.accessToken).toEqual(expect.any(String));
  });

  it('rejects a wrong password with a uniform message', async () => {
    const { email } = await h.registerUser();
    const response = await h
      .agent()
      .post('/api/v1/auth/login')
      .send({ email, password: 'Wr0ng!Passw0rd' })
      .expect(401);

    expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('gives the same error for an unknown account (no enumeration)', async () => {
    const response = await h
      .agent()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'Str0ng!Passw0rd' })
      .expect(401);

    expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });
});

describe('refresh token rotation', () => {
  it('rotates the token and issues a new access token', async () => {
    const { refreshToken } = await h.registerUser();

    const response = await h
      .agent()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(response.body.data.accessToken).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).not.toBe(refreshToken);
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const { refreshToken } = await h.registerUser();

    const first = await h
      .agent()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    // Replay of the consumed token => theft assumption.
    const replay = await h
      .agent()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    expect(replay.body.error.code).toBe('AUTH_REFRESH_REUSE');

    // The legitimate successor is now dead too.
    const successor = await h
      .agent()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.body.data.refreshToken })
      .expect(401);
    expect(successor.body.error.code).toBe('AUTH_REFRESH_REUSE');
  });

  it('rejects an unknown refresh token', async () => {
    await h
      .agent()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'this-token-does-not-exist' })
      .expect(401);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the profile for a valid access token', async () => {
    const { accessToken, email } = await h.registerUser();
    const response = await h
      .agent()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.data.user.email).toBe(email);
  });

  it('rejects a missing or invalid token', async () => {
    await h.agent().get('/api/v1/auth/me').expect(401);
    await h
      .agent()
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401);
  });
});

describe('logout', () => {
  it('invalidates the refresh token', async () => {
    const { refreshToken } = await h.registerUser();

    await h.agent().post('/api/v1/auth/logout').send({ refreshToken }).expect(204);

    await h.agent().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
  });
});
