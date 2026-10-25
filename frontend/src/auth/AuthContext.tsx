import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from '../api/client';
import type { AuthResponse, User } from '../api/types';

interface AuthState {
  /** undefined = still checking a saved token; null = signed out. */
  user: User | null | undefined;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null | undefined>(() => (tokenStore.get() ? undefined : null));

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
    // Drop every cached response so the next person on this browser sees nothing of ours.
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // A saved token might be expired, or its account deleted. Ask the API once on load.
  useEffect(() => {
    if (user !== undefined) return;
    api
      .get<{ userId: string; email: string }>('/auth/me')
      .then((me) => setUser({ id: me.userId, email: me.email }))
      .catch(() => logout());
  }, [user, logout]);

  const finish = useCallback((res: AuthResponse) => {
    tokenStore.set(res.accessToken);
    setUser(res.user);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      login: async (email, password) => finish(await api.post<AuthResponse>('/auth/login', { email, password })),
      register: async (email, password) =>
        finish(await api.post<AuthResponse>('/auth/register', { email, password })),
      logout,
    }),
    [user, finish, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
