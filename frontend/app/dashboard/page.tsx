"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { clearSession, getStoredUser } from "@/lib/auth/storage";
import type { AuthUser } from "@/lib/auth/api";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  function handleLogout() {
    clearSession();
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#1A1A1A]">
          Dashboard
        </h1>
        <p className="mt-2 text-[#8A8A8A]">
          {user
            ? `Signed in as ${user.name} (${user.email}) · ${user.role}`
            : "You are signed in."}
        </p>
      </div>
      <button
        type="button"
        onClick={handleLogout}
        className="w-fit rounded-full bg-[#1A1A1A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-black"
      >
        Log out
      </button>
    </main>
  );
}
