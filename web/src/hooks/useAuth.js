import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

/**
 * Restores a session once, before any route renders.
 *
 * Without this a hard reload would land on /login even though a valid refresh
 * token is sitting in localStorage - which is exactly the confusion the
 * architecture warns about (§15).
 */
export function useAuthBootstrap() {
  const initialised = useAuthStore((s) => s.initialised);
  const initialise = useAuthStore((s) => s.initialise);

  useEffect(() => {
    if (!initialised) initialise();
  }, [initialised, initialise]);

  return initialised;
}

/** Convenience selector: the signed-in user (or null). */
export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const logout = useAuthStore((s) => s.logout);
  return { user, loading, login, register, logout };
}
