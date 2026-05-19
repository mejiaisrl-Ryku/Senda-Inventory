import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { User } from "../types";
import { authApi } from "../api";

interface AuthState {
  user: User | null;
  token: string | null;
  bootstrapping: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, restaurantName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

function readStorage() {
  try {
    return {
      user: JSON.parse(localStorage.getItem("user") ?? "null") as User | null,
      token: localStorage.getItem("token"),
      refreshToken: localStorage.getItem("refreshToken"),
    };
  } catch {
    return { user: null, token: null, refreshToken: null };
  }
}

function storeSession(user: User, token: string, refreshToken: string) {
  localStorage.setItem("token", token);
  localStorage.setItem("refreshToken", refreshToken);
  localStorage.setItem("user", JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  // On mount: verify the stored token or silently refresh if expired.
  useEffect(() => {
    const { token: storedToken, refreshToken, user: storedUser } = readStorage();

    if (!storedToken && !refreshToken) {
      setBootstrapping(false);
      return;
    }

    (async () => {
      try {
        if (storedToken) {
          // Optimistically restore from storage, then confirm with the server.
          if (storedUser) {
            setUser(storedUser);
            setToken(storedToken);
          }
          const freshUser = await authApi.me();
          setUser(freshUser);
          setToken(storedToken);
          localStorage.setItem("user", JSON.stringify(freshUser));
        }
      } catch {
        // Access token expired — try refresh.
        if (refreshToken) {
          try {
            const data = await authApi.refresh(refreshToken);
            storeSession(data.user, data.token, data.refreshToken);
            setUser(data.user);
            setToken(data.token);
          } catch {
            clearSession();
            setUser(null);
            setToken(null);
          }
        } else {
          clearSession();
          setUser(null);
          setToken(null);
        }
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await authApi.login(email, password);
    storeSession(data.user, data.token, data.refreshToken);
    setUser(data.user);
    setToken(data.token);
  }, []);

  const register = useCallback(
    async (email: string, password: string, restaurantName: string) => {
      const data = await authApi.register({ email, password, restaurantName });
      storeSession(data.user, data.token, data.refreshToken);
      setUser(data.user);
      setToken(data.token);
    },
    []
  );

  const logout = useCallback(() => {
    authApi.logout().catch(() => {});
    clearSession();
    setUser(null);
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        bootstrapping,
        isAuthenticated: !!token && !!user,
        isAdmin: user?.role === "ADMIN",
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
