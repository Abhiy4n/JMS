"use client";

import { useEffect, useState } from "react";

import { getStoredUser } from "./auth/storage";

export const DEFAULT_COMPANY_NAME = "Admin";

export function useCompanyName() {
  const [companyName, setCompanyName] = useState(DEFAULT_COMPANY_NAME);

  useEffect(() => {
    function syncCompanyName() {
      setCompanyName(getStoredUser()?.company_name?.trim() || DEFAULT_COMPANY_NAME);
    }

    syncCompanyName();
    window.addEventListener("storage", syncCompanyName);
    window.addEventListener("jms-session-updated", syncCompanyName);
    return () => {
      window.removeEventListener("storage", syncCompanyName);
      window.removeEventListener("jms-session-updated", syncCompanyName);
    };
  }, []);

  return companyName;
}
