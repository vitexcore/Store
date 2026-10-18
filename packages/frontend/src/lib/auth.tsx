/**
 * Authentication context — manages the current user's auth state.
 *
 * - On mount, calls GET /api/auth/me to check if the user has a valid session.
 * - Provides login, register, and logout functions.
 * - Exposes loading, user, and error states for the UI.
 * - Never stores auth tokens in localStorage — all auth is cookie-based.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api, resetCsrfToken } from './api.js';
import type { AuthUser } from '@store/shared';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, storeName: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check if the user has a valid session on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await api.auth.me();
      if (!mounted) return;
      if (res.ok && res.data.user) {
        setUser(res.data.user);
      } else {
        setUser(null);
      }
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setError(null);
    setLoading(true);
    const res = await api.auth.login(email, password);
    setLoading(false);
    if (res.ok) {
      setUser(res.data.user);
      return true;
    }
    setError(res.message);
    return false;
  }, []);

  const register = useCallback(async (email: string, password: string, storeName: string): Promise<boolean> => {
    setError(null);
    setLoading(true);
    const res = await api.auth.register(email, password, storeName);
    setLoading(false);
    if (res.ok) {
      setUser(res.data.user);
      return true;
    }
    setError(res.message);
    return false;
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    await api.auth.logout();
    resetCsrfToken();
    setUser(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider value={{ user, loading, error, login, register, logout, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
