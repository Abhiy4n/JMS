"use client";

import { useEffect, type ReactNode } from "react";
import { LoaderCircle, RefreshCw, ServerOff, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";

import { useAuth } from "./AuthProvider";

export default function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status, revalidationStatus, verifySession } = useAuth();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [router, status]);

  if (status === "authenticated") {
    return <>
      {children}
      {revalidationStatus === "unavailable" && (
        <div className="fixed bottom-4 right-4 z-[100] flex max-w-sm items-center gap-2 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3 text-sm text-[var(--app-text)] shadow-lg" role="status">
          <WifiOff aria-hidden="true" className="size-4 shrink-0" />
          <span>Connection interrupted. Your page is preserved while the session is rechecked.</span>
          <button type="button" className="font-semibold underline" onClick={() => void verifySession(true)}>Retry</button>
        </div>
      )}
    </>;
  }

  if (status === "unavailable") {
    return (
      <main className="flex min-h-svh flex-1 items-center justify-center bg-[var(--app-canvas)] p-6">
        <section className="w-full max-w-md rounded-2xl border border-[var(--app-border)] bg-[var(--app-surface)] p-8 text-center shadow-sm" aria-labelledby="auth-unavailable-title">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--app-red-wash)] text-[var(--app-red)]"><ServerOff aria-hidden="true" className="size-6" /></span>
          <h1 id="auth-unavailable-title" className="mt-5 text-xl font-semibold text-[var(--app-text-strong)]">Unable to verify your session</h1>
          <p className="mt-2 leading-6 text-[var(--app-muted)]">The server is temporarily unavailable. No session data has been discarded.</p>
          <button type="button" onClick={() => void verifySession(true)} className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--app-accent)] px-4 py-2.5 font-medium text-[var(--app-accent-contrast)] transition-colors hover:bg-[var(--app-accent-hover)]">
            <RefreshCw aria-hidden="true" className="size-4" />Try again
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-3 bg-[var(--app-canvas)] text-[var(--app-muted)]" aria-live="polite" aria-busy="true">
      <LoaderCircle aria-hidden="true" className="size-7 animate-spin text-[var(--app-text-strong)]" />
      <p>{status === "unauthenticated" ? "Redirecting to login…" : "Verifying your session…"}</p>
    </main>
  );
}
