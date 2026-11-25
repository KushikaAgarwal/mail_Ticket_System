import React, { createContext, useContext, useState } from 'react';

/** Hierarchy: SUPER_ADMIN > SUPERVISOR > ZONAL_ADMIN > MANAGER > LEAD > CUSTOMER_SUPPORT */
export type Role =
  | 'SUPER_ADMIN'
  | 'SUPERVISOR'
  | 'ZONAL_ADMIN'
  | 'MANAGER'
  | 'LEAD'
  | 'CUSTOMER_SUPPORT';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  zoneId?: number | null;
  zoneName?: string;
}

interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  login: (user: AuthUser, token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export function getInitials(user: Pick<AuthUser, 'name'>): string {
  return user.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export const STORAGE_KEY = 'mailMgmtAdminUser';
export const TOKEN_KEY = 'mailMgmtAdminToken';

const VALID_ROLES: Role[] = ['SUPER_ADMIN', 'SUPERVISOR', 'ZONAL_ADMIN', 'MANAGER', 'LEAD', 'CUSTOMER_SUPPORT'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // A session saved before the role change (e.g. ZONAL_EXECUTIVE) is no
      // longer valid, so drop it and force a fresh login.
      if (!VALID_ROLES.includes(parsed?.role)) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(TOKEN_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });

  const login = (u: AuthUser, t: string) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    localStorage.setItem(TOKEN_KEY, t);
    setUser(u);
    setToken(t);
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}