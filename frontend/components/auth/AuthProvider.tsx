"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  ApiError,
  fetchMe,
  resetExpirationAnnouncement,
  type AuthResponse,
  type AuthUser,
} from "@/lib/auth/api";
import {
  ACCESS_KEY,
  clearSession,
  getAccessToken,
  getStoredUser,
  REFRESH_KEY,
  saveSession,
  SESSION_EXPIRED_EVENT,
  SESSION_UPDATED_EVENT,
  updateStoredUser,
  USER_KEY,
} from "@/lib/auth/storage";

export type AuthenticationStatus = "checking" | "authenticated" | "unauthenticated" | "unavailable";
export type RevalidationStatus = "idle" | "checking" | "unavailable";

type AuthContextValue = {
  status: AuthenticationStatus;
  revalidationStatus: RevalidationStatus;
  user: AuthUser | null;
  completeAuthentication: (response: AuthResponse, remember: boolean) => void;
  clearAuthentication: () => void;
  verifySession: (force?: boolean) => Promise<void>;
};

const configuredInterval = Number(process.env.NEXT_PUBLIC_AUTH_REVALIDATE_MS || "300000");
export const AUTH_REVALIDATE_INTERVAL_MS = Number.isFinite(configuredInterval) && configuredInterval >= 1000
  ? configuredInterval
  : 300000;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthenticationStatus>("checking");
  const [revalidationStatus, setRevalidationStatus] = useState<RevalidationStatus>("idle");
  const [user, setUser] = useState<AuthUser | null>(null);
  const statusRef = useRef<AuthenticationStatus>("checking");
  const userRef = useRef<AuthUser | null>(null);
  const lastVerifiedAt = useRef(0);
  const verificationInFlight = useRef<Promise<void> | null>(null);
  const verificationGeneration = useRef(0);

  const updateStatus = useCallback((next: AuthenticationStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const updateUser = useCallback((next: AuthUser | null) => {
    userRef.current = next;
    setUser(next);
  }, []);

  const clearAuthentication = useCallback(() => {
    verificationGeneration.current += 1;
    clearSession();
    lastVerifiedAt.current = 0;
    updateUser(null);
    setRevalidationStatus("idle");
    updateStatus("unauthenticated");
  }, [updateStatus, updateUser]);

  const completeAuthentication = useCallback((response: AuthResponse, remember: boolean) => {
    verificationGeneration.current += 1;
    saveSession({ access: response.access, refresh: response.refresh }, response.user, remember);
    resetExpirationAnnouncement();
    lastVerifiedAt.current = Date.now();
    updateUser(response.user);
    setRevalidationStatus("idle");
    updateStatus("authenticated");
  }, [updateStatus, updateUser]);

  const verifySession = useCallback(async (force = false) => {
    if (verificationInFlight.current) return verificationInFlight.current;
    if (!force && Date.now() - lastVerifiedAt.current < AUTH_REVALIDATE_INTERVAL_MS) return;

    const accessToken = getAccessToken();
    if (!accessToken) {
      clearAuthentication();
      return;
    }

    const hadAuthenticatedContent = statusRef.current === "authenticated" && userRef.current !== null;
    const generation = verificationGeneration.current;
    if (hadAuthenticatedContent) setRevalidationStatus("checking");
    else updateStatus("checking");

    const verification = (async () => {
      try {
        const verifiedUser = await fetchMe(accessToken);
        if (generation !== verificationGeneration.current || accessToken !== getAccessToken()) return;
        updateStoredUser(verifiedUser);
        updateUser(verifiedUser);
        lastVerifiedAt.current = Date.now();
        setRevalidationStatus("idle");
        updateStatus("authenticated");
      } catch (error) {
        if (generation !== verificationGeneration.current || accessToken !== getAccessToken()) return;
        if (error instanceof ApiError && error.kind === "cancelled") return;
        if (error instanceof ApiError && error.status === 401) {
          clearAuthentication();
          return;
        }
        if (hadAuthenticatedContent) {
          setRevalidationStatus("unavailable");
          return;
        }
        updateStatus("unavailable");
      } finally {
        verificationInFlight.current = null;
      }
    })();
    verificationInFlight.current = verification;
    return verification;
  }, [clearAuthentication, updateStatus, updateUser]);

  useEffect(() => {
    const initialVerification = window.setTimeout(() => {
      const accessToken = getAccessToken();
      const storedUser = getStoredUser();
      if (!accessToken) {
        updateStatus("unauthenticated");
        return;
      }
      if (storedUser) {
        // Cached identity preserves the UI only; every API permission remains backend-authoritative.
        updateUser(storedUser);
        updateStatus("authenticated");
        setRevalidationStatus("checking");
      }
      void verifySession(true);
    }, 0);
    return () => window.clearTimeout(initialVerification);
  }, [updateStatus, updateUser, verifySession]);

  useEffect(() => {
    function verifyWhenActive() {
      if (document.visibilityState === "visible" && statusRef.current === "authenticated") {
        void verifySession();
      }
    }

    function synchronizeStorage(event: StorageEvent) {
      if (event.key === USER_KEY) {
        updateUser(getStoredUser());
        return;
      }
      if (event.key !== ACCESS_KEY && event.key !== REFRESH_KEY && event.key !== null) return;
      const accessToken = getAccessToken();
      if (!accessToken) {
        updateUser(null);
        updateStatus("unauthenticated");
        return;
      }
      resetExpirationAnnouncement();
      const storedUser = getStoredUser();
      if (storedUser) {
        updateUser(storedUser);
        updateStatus("authenticated");
      }
      lastVerifiedAt.current = 0;
      void verifySession(true);
    }

    function synchronizeCurrentTab() {
      const storedUser = getStoredUser();
      if (storedUser) updateUser(storedUser);
      if (!getAccessToken()) updateStatus("unauthenticated");
    }

    function sessionExpired() {
      lastVerifiedAt.current = 0;
      updateUser(null);
      setRevalidationStatus("idle");
      updateStatus("unauthenticated");
    }

    window.addEventListener("focus", verifyWhenActive);
    window.addEventListener("storage", synchronizeStorage);
    window.addEventListener(SESSION_UPDATED_EVENT, synchronizeCurrentTab);
    window.addEventListener(SESSION_EXPIRED_EVENT, sessionExpired);
    document.addEventListener("visibilitychange", verifyWhenActive);
    return () => {
      window.removeEventListener("focus", verifyWhenActive);
      window.removeEventListener("storage", synchronizeStorage);
      window.removeEventListener(SESSION_UPDATED_EVENT, synchronizeCurrentTab);
      window.removeEventListener(SESSION_EXPIRED_EVENT, sessionExpired);
      document.removeEventListener("visibilitychange", verifyWhenActive);
    };
  }, [updateStatus, updateUser, verifySession]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    revalidationStatus,
    user,
    completeAuthentication,
    clearAuthentication,
    verifySession,
  }), [status, revalidationStatus, user, completeAuthentication, clearAuthentication, verifySession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>.");
  return context;
}
