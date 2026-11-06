/** The signed-in session, as on the web (frontend/src/lib/auth-context.tsx):
 * a short-lived access token in memory, a rotating refresh token in secure
 * storage, and the current workspace. Signing in once keeps the phone signed
 * in until sign-out or the refresh token's 30 days lapse unused. */
import type { components } from "@iodriven/shared/api";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { isRejection, pickTenant, RETRY_DELAYS_MS } from "./session";
import { sessionStorage } from "./storage";

type TokenPairResponse = components["schemas"]["TokenPairResponse"];
type MembershipSummary = components["schemas"]["MembershipSummary"];

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthState {
  accessToken: string | null;
  memberships: MembershipSummary[];
  currentTenantId: string | null;
  status: AuthStatus;
}

interface AuthContextValue extends AuthState {
  currentMembership: MembershipSummary | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-authenticates from the stored refresh token; returns the fresh pair so
   * a request that hit a 401 can retry before the next render. */
  refresh: () => Promise<TokenPairResponse | null>;
  setCurrentTenantId: (tenantId: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const signedOut: AuthState = { accessToken: null, memberships: [], currentTenantId: null, status: "unauthenticated" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...signedOut, status: "loading" });

  const applySession = useCallback(async (data: TokenPairResponse) => {
    const tenantId = pickTenant(data.memberships, null, await sessionStorage.readTenantId());
    await sessionStorage.writeRefreshToken(data.refresh_token);
    if (tenantId) await sessionStorage.writeTenantId(tenantId);
    setState({ accessToken: data.access_token, memberships: data.memberships, currentTenantId: tenantId, status: "authenticated" });
  }, []);

  const clearSession = useCallback(async () => {
    await sessionStorage.clear();
    setState(signedOut);
  }, []);

  // Refresh tokens rotate, and the API treats a rotated one presented again
  // as a replay that revokes the session, so requests that hit a 401
  // together share one refresh.
  const inFlight = useRef<Promise<TokenPairResponse | null> | null>(null);
  const refresh = useCallback((): Promise<TokenPairResponse | null> => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      for (let attempt = 0; ; attempt++) {
        const refreshToken = await sessionStorage.readRefreshToken();
        if (!refreshToken) {
          setState(signedOut);
          return null;
        }
        try {
          const data = await api.post<TokenPairResponse>("/auth/refresh", {}, { refresh_token: refreshToken });
          await applySession(data);
          return data;
        } catch (err) {
          if (isRejection(err)) {
            await clearSession();
            return null;
          }
          if (attempt >= RETRY_DELAYS_MS.length) {
            // Still unreachable: keep a session already in use (a later
            // request tries again); a cold start with nothing to show signs in.
            setState((s) => (s.accessToken ? s : signedOut));
            return null;
          }
          await sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
    })().finally(() => {
      inFlight.current = null;
    });
    inFlight.current = run;
    return run;
  }, [applySession, clearSession]);

  // Resume the stored session on launch.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<TokenPairResponse>("/auth/login", {}, { email: email.trim(), password });
      await applySession(data);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    const refreshToken = await sessionStorage.readRefreshToken();
    if (refreshToken) {
      try {
        await api.post("/auth/logout", {}, { refresh_token: refreshToken });
      } catch {
        // Best effort: the phone forgets the session either way.
      }
    }
    await clearSession();
  }, [clearSession]);

  const setCurrentTenantId = useCallback((tenantId: string) => {
    void sessionStorage.writeTenantId(tenantId);
    setState((s) => ({ ...s, currentTenantId: tenantId }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      currentMembership: state.memberships.find((m) => m.tenant_id === state.currentTenantId) ?? null,
      login,
      logout,
      refresh,
      setCurrentTenantId,
    }),
    [state, login, logout, refresh, setCurrentTenantId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
