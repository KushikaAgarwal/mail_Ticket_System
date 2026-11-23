import React, { createContext, useContext, useState } from 'react';



export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'SUPERVISOR' | 'ZONAL_ADMIN' | 'ZONAL_EXECUTIVE' | 'CUSTOMER_SUPPORT';
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
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