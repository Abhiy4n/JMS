"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import BusinessAppShell from "@/components/BusinessAppShell";

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
  const usesAppShell = APP_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  return usesAppShell ? <BusinessAppShell>{children}</BusinessAppShell> : children;
}
