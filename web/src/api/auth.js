import { http, request, saveSession, clearSession, getRefreshToken } from './client';

/** POST /auth/register - returns a fully signed-in session. */
export async function register({ email, password, name }) {
  const { data } = await request({ method: 'post', url: '/auth/register', data: { email, password, name } });
  saveSession(data);
  return data;
}

/** POST /auth/login */
export async function login({ email, password }) {
  const { data } = await request({ method: 'post', url: '/auth/login', data: { email, password } });
  saveSession(data);
  return data;
}

/** GET /auth/me - used to restore a session after a page reload. */
export async function fetchMe() {
  const { data } = await request({ method: 'get', url: '/auth/me' });
  return data.user;
}

/** POST /auth/logout - best effort; the local session is cleared either way. */
export async function logout() {
  try {
    const refreshToken = getRefreshToken();
    if (refreshToken) await http.post('/auth/logout', { refreshToken });
  } catch {
    /* the refresh token may already be rotated or revoked server-side */
  } finally {
    clearSession();
  }
}
