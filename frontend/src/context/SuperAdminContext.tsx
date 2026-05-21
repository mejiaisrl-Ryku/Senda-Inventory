import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { superAdminApi } from "../api/superAdmin";

interface SAUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

interface SuperAdminState {
  saUser: SAUser | null;
  bootstrapping: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<SuperAdminState | null>(null);

const SA_TOKEN_KEY = "sa_token";
const SA_REFRESH_KEY = "sa_refresh_token";
const SA_USER_KEY = "sa_user";

export function SuperAdminProvider({ children }: { children: React.ReactNode }) {
  const [saUser, setSaUser] = useState<SAUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(SA_USER_KEY);
    const token = localStorage.getItem(SA_TOKEN_KEY);
    if (stored && token) {
      try {
        setSaUser(JSON.parse(stored));
      } catch {
        /* ignore malformed JSON */
      }
    }
    setBootstrapping(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await superAdminApi.login(email, password);
    // Role enforcement is done server-side; the endpoint 403s non-SUPER_ADMIN accounts.
    localStorage.setItem(SA_TOKEN_KEY, data.token);
    localStorage.setItem(SA_REFRESH_KEY, data.refreshToken);
    localStorage.setItem(SA_USER_KEY, JSON.stringify(data.user));
    setSaUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(SA_TOKEN_KEY);
    localStorage.removeItem(SA_REFRESH_KEY);
    localStorage.removeItem(SA_USER_KEY);
    setSaUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ saUser, bootstrapping, isAuthenticated: !!saUser, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSuperAdmin() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSuperAdmin must be used inside SuperAdminProvider");
  return ctx;
}
