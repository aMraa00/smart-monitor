import axios from 'axios';

/**
 * Single HTTP client for the dashboard.
 *
 * Responsibilities kept here (so no component ever touches transport):
 *   - base URL: same-origin dev proxy in development, VITE_API_BASE_URL in prod
 *   - attaches the Bearer access token
 *   - transparently refreshes an expired access token ONCE and replays the
 *     original request (the API rotates refresh tokens, so a replayed token is
 *     rejected by the backend - hence the single-flight guard)
 *   - unwraps the API envelope { success, data, meta } and normalises errors
 *     into a plain { code, message, status, details } object
 */

export const API_PREFIX = '/api/v1';

/**
 * Normalise the configured API origin.
 *
 * Deployment UIs (Vercel dashboard, Render, .env editors) make it very easy to
 * paste a trailing space or newline, which lands in the bundle verbatim and
 * produces requests like `https://host%20/api/v1/...` -> ERR_NAME_NOT_RESOLVED.
 * Trimming here makes that mistake impossible to ship, and stripping trailing
 * slashes keeps `${baseURL}${API_PREFIX}` from producing a double slash.
 */
function normaliseBaseUrl(raw) {
  return String(raw || '').trim().replace(/\/+$/, '');
}

const baseURL = normaliseBaseUrl(import.meta.env.VITE_API_BASE_URL);

/** Absolute API origin in production ('' = same-origin dev proxy). */
export const API_BASE = baseURL;

export const tokenStore = {
  read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key, value) {
    try {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch {
      /* storage disabled - session simply does not survive a reload */
    }
  },
  clear() {
    tokenStore.write('sm.accessToken', null);
    tokenStore.write('sm.refreshToken', null);
  },
};

export const getAccessToken = () => tokenStore.read('sm.accessToken');
export const getRefreshToken = () => tokenStore.read('sm.refreshToken');

export function saveSession({ accessToken, refreshToken }) {
  if (accessToken) tokenStore.write('sm.accessToken', accessToken);
  if (refreshToken) tokenStore.write('sm.refreshToken', refreshToken);
}

export function clearSession() {
  tokenStore.clear();
}

/** Convert an axios failure into the error shape the UI renders. */
function normalise(error) {
  if (error.response) {
    const body = error.response.data || {};
    const envelope = body.error || {};
    return Object.assign(
      new Error(envelope.message || error.message || 'Request failed'),
      {
        code: envelope.code || 'REQUEST_FAILED',
        status: error.response.status,
        details: envelope.details,
      }
    );
  }
  return Object.assign(new Error('Cannot reach the API'), {
    code: 'NETWORK_ERROR',
    status: 0,
  });
}

export const http = axios.create({
  baseURL: `${baseURL}${API_PREFIX}`,
  timeout: 20000,
});

http.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Refresh the token pair; concurrent callers share one in-flight refresh. */
let refreshInFlight = null;
async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('NO_REFRESH_TOKEN');

  refreshInFlight = axios
    .post(`${baseURL}${API_PREFIX}/auth/refresh`, { refreshToken }, { timeout: 15000 })
    .then((response) => {
      saveSession(response.data.data);
      return response.data.data;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config || {};
    const isAuthPath = String(original.url || '').includes('/auth/');
    const unauthorized = error.response && error.response.status === 401;

    // Only a used-and-expired token is worth refreshing; a bad password or a
    // failed refresh must propagate to the caller untouched.
    if (unauthorized && !isAuthPath && !original._retried) {
      original._retried = true;
      try {
        await refreshSession();
        return http.request(original);
      } catch (refreshError) {
        clearSession();
        // Let the caller (usually the route guard) send the user to /login.
        if (refreshError && refreshError.message === 'NO_REFRESH_TOKEN') {
          return Promise.reject(normalise(error));
        }
      }
    }

    return Promise.reject(normalise(error));
  }
);

/**
 * Perform a request and unwrap the API envelope.
 * @returns {Promise<{data:*, meta:*}>}
 */
export async function request(config) {
  const response = await http.request(config);
  return { data: response.data ? response.data.data : undefined, meta: response.data ? response.data.meta : undefined };
}
