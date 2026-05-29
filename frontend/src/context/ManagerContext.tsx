import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { superAdminApi } from "../api/superAdmin";

interface MgrUser {
  id:    string;
  name:  string | null;
  email: string;
  role:  string;
}

interface ManagerState {
  mgrUser:         MgrUser | null;
  bootstrapping:   boolean;
  isAuthenticated: boolean;
  login:  (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<ManagerState | null>(null);

const MGR_TOKEN_KEY   = "mgr_token";
const MGR_REFRESH_KEY = "mgr_refresh_token";
const MGR_USER_KEY    = "mgr_user";

const ALLOWED_ROLES = ["KYRU_MANAGER", "SUPER_ADMIN"];

export function ManagerProvider({ children }: { children: React.ReactNode }) {
  const [mgrUser,      setMgrUser]      = useState<MgrUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(MGR_USER_KEY);
    const token  = localStorage.getItem(MGR_TOKEN_KEY);
    if (stored && token) {
      try {
        const u = JSON.parse(stored) as MgrUser;
        if (ALLOWED_ROLES.includes(u.role)) setMgrUser(u);
        else localStorage.removeItem(MGR_USER_KEY);
      } catch { /* ignore malformed JSON */ }
    }
    setBootstrapping(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await superAdminApi.login(email, password);
    if (!ALLOWED_ROLES.includes(data.user.role)) {
      throw new Error("Access restricted to Kyru Managers only");
    }
    localStorage.setItem(MGR_TOKEN_KEY,   data.token);
    localStorage.setItem(MGR_REFRESH_KEY, data.refreshToken);
    localStorage.setItem(MGR_USER_KEY,    JSON.stringify(data.user));
    setMgrUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(MGR_TOKEN_KEY);
    localStorage.removeItem(MGR_REFRESH_KEY);
    localStorage.removeItem(MGR_USER_KEY);
    setMgrUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ mgrUser, bootstrapping, isAuthenticated: !!mgrUser, login, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useManager() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useManager must be used inside ManagerProvider");
  return ctx;
}
