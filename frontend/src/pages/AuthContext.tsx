import React, { createContext, useContext, useState } from 'react';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ZONE_MANAGER' | 'ZONE_ADMIN' | 'ENGINEER' | 'CUSTOMER_CARE';
}
interface AuthCtx {
  user: AuthUser | null;
  login: (user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx>({ user: null, login: () => {}, logout: () => {} });

export const useAuth = () => useContext(AuthContext);

export function getInitials(user: Pick<AuthUser, 'name'>): string {
  return user.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

const STORAGE_KEY = 'mailMgmtAdminUser';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const login = (u: AuthUser) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}
