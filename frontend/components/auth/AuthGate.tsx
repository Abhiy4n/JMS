"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, RefreshCw, ServerOff } from "lucide-react";
import { useRouter } from "next/navigation";

import { ApiError, fetchMe } from "@/lib/auth/api";
import {
  clearSession,
  getAccessToken,
  updateStoredUser,
} from "@/lib/auth/storage";

type AuthState = "checking" | "authenticated" | "unavailable";

export default function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const verificationId = useRef(0);
  const [authState, setAuthState] = useState<AuthState>("checking");

  const verifySession = useCallback(async () => {
    const currentVerification = ++verificationId.current;
    const accessToken = getAccessToken();

    if (!accessToken) {
      clearSession();
      router.replace("/login");
      return;
    }

    setAuthState("checking");
    try {
      const user = await fetchMe(accessToken);
      if (currentVerification !== verificationId.current) return;
      updateStoredUser(user);
      setAuthState("authenticated");
    } catch (error) {
      if (currentVerification !== verificationId.current) return;

      if (error instanceof ApiError && error.status === 401) {
        clearSession();
        router.replace("/login");
        return;
      }

      setAuthState("unavailable");
    }
  }, [router]);

  useEffect(() => {
    const initialVerification = window.setTimeout(() => void verifySession(), 0);

    function verifyWhenActive() {
      if (document.visibilityState === "visible") void verifySession();
    }

    window.addEventListener("focus", verifyWhenActive);
    window.addEventListener("storage", verifyWhenActive);
    document.addEventListener("visibilitychange", verifyWhenActive);
    return () => {
      window.clearTimeout(initialVerification);
      verificationId.current += 1;
      window.removeEventListener("focus", verifyWhenActive);
      window.removeEventListener("storage", verifyWhenActive);
      document.removeEventListener("visibilitychange", verifyWhenActive);
    };
  }, [verifySession]);

  if (authState === "authenticated") return children;

  if (authState === "unavailable") {
    return (
      <main className="flex min-h-svh flex-1 items-center justify-center bg-[var(--app-canvas)] p-6">
        <section
          className="w-full max-w-md rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-8 text-center shadow-sm"
          aria-labelledby="auth-unavailable-title"
        >
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--app-red-wash)] text-[var(--app-red)]">
            <ServerOff aria-hidden="true" className="size-6" />
          </span>
          <h1 id="auth-unavailable-title" className="mt-5 text-xl font-semibold text-[var(--app-text-strong)]">
            Unable to verify your session
          </h1>
          <p className="mt-2 leading-6 text-[var(--app-muted)]">
            The server is unavailable right now. Your account pages will stay locked until the connection is restored.
          </p>
          <button
            type="button"
            onClick={() => void verifySession()}
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--app-accent)] px-4 py-2.5 font-medium text-[var(--app-accent-contrast)] transition-colors hover:bg-[var(--app-accent-hover)]"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
            Try again
          </button>
        </section>
      </main>
    );
  }

  return (
    <main
      className="flex min-h-svh flex-1 flex-col items-center justify-center gap-3 bg-[var(--app-canvas)] text-[var(--app-muted)]"
      aria-live="polite"
      aria-busy="true"
    >
      <LoaderCircle aria-hidden="true" className="size-7 animate-spin text-[var(--app-text-strong)]" />
      <p>Verifying your session…</p>
    </main>
  );
}
