"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import BusinessAppShell from "@/components/BusinessAppShell";
import AuthGate from "@/components/auth/AuthGate";
import { useAuth } from "@/components/auth/AuthProvider";

const APP_PATHS = [
  "/dashboard",
  "/customers",
  "/bills",
  "/business-sources",
  "/api-docs",
  "/settings",
];

export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useAuth();
  const isPublicPath = pathname === "/login" || pathname === "/signup";
  const usesAppShell = APP_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const content = usesAppShell ? <BusinessAppShell>{children}</BusinessAppShell> : children;

  useEffect(() => {
    if (isPublicPath && status === "authenticated") router.replace("/dashboard");
  }, [isPublicPath, router, status]);

  if (isPublicPath && status === "authenticated") return null;

  return isPublicPath ? content : <AuthGate>{content}</AuthGate>;
}
