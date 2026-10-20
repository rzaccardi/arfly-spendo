import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api';

type AuthState = {
  loading: boolean;
  authenticated: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  const refresh = useCallback(async () => {
    try {
      await api('/admin/api/me');
      setAuthenticated(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthenticated(false);
      } else {
        setAuthenticated(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (password: string) => {
    await api('/admin/api/login', { method: 'POST', json: { password } });
    setAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    await api('/admin/api/logout', { method: 'POST' });
    setAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ loading, authenticated, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
