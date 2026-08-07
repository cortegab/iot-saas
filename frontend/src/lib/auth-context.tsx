"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiClient, ApiRequestError } from "@/lib/api-client";
import type { components } from "@/types/api";

type TokenPairResponse = components["schemas"]["TokenPairResponse"];
type MembershipSummary = components["schemas"]["MembershipSummary"];

const REFRESH_TOKEN_KEY = "iot-saas:refresh_token";
const TENANT_ID_KEY = "iot-saas:tenant_id";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  accessToken: string | null;
  memberships: MembershipSummary[];
  currentTenantId: string | null;
  status: AuthStatus;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, tenantName: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-authenticates from the stored refresh token; returns the fresh session on
   * success so a caller mid-request can retry with the new access token without
   * waiting on this component's next render. */
  refresh: () => Promise<TokenPairResponse | null>;
  setCurrentTenantId: (tenantId: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const initialState: AuthState = {
  accessToken: null,
  memberships: [],
  currentTenantId: null,
  status: "loading",
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  const applySession = useCallback((data: TokenPairResponse, tenantOverride?: string) => {
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
    const tenantId =
      tenantOverride ?? localStorage.getItem(TENANT_ID_KEY) ?? data.memberships[0]?.tenant_id ?? null;
    if (tenantId) localStorage.setItem(TENANT_ID_KEY, tenantId);
    setState({
      accessToken: data.access_token,
      memberships: data.memberships,
      currentTenantId: tenantId,
      status: "authenticated",
    });
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(TENANT_ID_KEY);
    setState({ accessToken: null, memberships: [], currentTenantId: null, status: "unauthenticated" });
  }, []);

  const refresh = useCallback(async (): Promise<TokenPairResponse | null> => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      setState((s) => ({ ...s, status: "unauthenticated" }));
      return null;
    }
    try {
      const data = await apiClient.post<TokenPairResponse>("/auth/refresh", {}, { refresh_token: refreshToken });
      applySession(data);
      return data;
    } catch {
      clearSession();
      return null;
    }
  }, [applySession, clearSession]);

  // Resume a session from the persisted refresh token on first load, so a reload
  // doesn't bounce an already-logged-in user back to /login.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await apiClient.post<TokenPairResponse>("/auth/login", {}, { email, password });
      applySession(data);
    },
    [applySession],
  );

  const register = useCallback(
    async (email: string, password: string, tenantName: string, name?: string) => {
      const data = await apiClient.post<TokenPairResponse>("/auth/register", {}, {
        email,
        password,
        tenant_name: tenantName,
        name: name?.trim() || undefined,
      });
      applySession(data);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (refreshToken) {
      try {
        await apiClient.post("/auth/logout", {}, { refresh_token: refreshToken });
      } catch {
        // Best-effort — the local session is cleared regardless of server outcome.
      }
    }
    clearSession();
  }, [clearSession]);

  const setCurrentTenantId = useCallback((tenantId: string) => {
    localStorage.setItem(TENANT_ID_KEY, tenantId);
    setState((s) => ({ ...s, currentTenantId: tenantId }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, register, logout, refresh, setCurrentTenantId }),
    [state, login, register, logout, refresh, setCurrentTenantId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within an AuthProvider");
  return ctx;
}

export { ApiRequestError };
