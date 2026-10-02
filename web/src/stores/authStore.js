import { create } from 'zustand';
import * as authApi from '../api/auth';
import { getAccessToken } from '../api/client';

/**
 * Session state.
 *
 * `accessToken` lives in localStorage (see api/client.js); this store only
 * mirrors "am I signed in" plus the profile needed to render the UI. Route
 * guards read `initialised` so a reload never flashes the login screen.
 */
export const useAuthStore = create((set) => ({
  user: null,
  accessToken: null,
  initialised: false,
  loading: false,

  /** Restore the session from a stored refresh token (page reload). */
  async initialise() {
    try {
      if (!localStorage.getItem('sm.refreshToken')) return;
      const user = await authApi.fetchMe();
      set({ user, accessToken: getAccessToken() });
    } catch {
      // Rotated-away or revoked token: the client already cleared the session.
      set({ user: null, accessToken: null });
    } finally {
      set({ initialised: true });
    }
  },

  async login(email, password) {
    set({ loading: true });
    try {
      const session = await authApi.login({ email, password });
      set({ user: session.user, accessToken: session.accessToken, loading: false });
      return session.user;
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  async register(payload) {
    set({ loading: true });
    try {
      const session = await authApi.register(payload);
      set({ user: session.user, accessToken: session.accessToken, loading: false });
      return session.user;
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  async logout() {
    await authApi.logout();
    set({ user: null, accessToken: null });
  },
}));
