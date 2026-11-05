"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import BusinessAppShell from "@/components/BusinessAppShell";
import AuthGate from "@/components/auth/AuthGate";

const APP_PATHS = [
  "/dashboard",
  "/customers",
  "/bills",
  "/accounts",
  "/business-sources",
  "/api-docs",
  "/settings",
];

export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublicPath = pathname === "/login" || pathname === "/signup";
  const usesAppShell = APP_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const content = usesAppShell ? <BusinessAppShell>{children}</BusinessAppShell> : children;

  return isPublicPath ? content : <AuthGate>{content}</AuthGate>;
}
