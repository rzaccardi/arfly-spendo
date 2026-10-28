import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api';

export type LoginResult =
  | { authenticated: true; mfa_required: false }
  | {
      authenticated: false;
      mfa_required: true;
      mfa_token: string;
      expires_in_seconds: number;
    };

type AuthState = {
  loading: boolean;
  authenticated: boolean;
  login: (opts: {
    password?: string;
    mfa_token?: string;
    totp_code?: string;
    recovery_code?: string;
  }) => Promise<LoginResult>;
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

  const login = useCallback(
    async (opts: {
      password?: string;
      mfa_token?: string;
      totp_code?: string;
      recovery_code?: string;
    }): Promise<LoginResult> => {
      const res = await api<{ data: LoginResult }>('/admin/api/login', {
        method: 'POST',
        json: opts,
      });
      if (res.data.mfa_required) {
        return res.data;
      }
      setAuthenticated(true);
      return res.data;
    },
    [],
  );

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
