"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, login } from "@/lib/auth/api";
import { saveSession } from "@/lib/auth/storage";

import { PasswordInput } from "./PasswordInput";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const remember = form.get("remember") === "on";

    try {
      const data = await login({ email, password });
      saveSession(
        { access: data.access, refresh: data.refresh },
        data.user,
        remember
      );
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to reach the server. Is the API running?");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col">
      <h1 className="text-[1.75rem] font-bold tracking-tight text-[#1A1A1A]">
        Welcome back!
      </h1>
      <p className="mt-1.5 text-[0.95rem] text-[#8A8A8A]">
        Please enter your details
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-8 flex flex-col gap-6 md:mt-10 md:gap-7"
      >
        <div className="flex flex-col gap-2">
          <label
            htmlFor="login-email"
            className="text-sm font-medium text-[#1A1A1A]"
          >
            Email
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full border-0 border-b border-[#D4D4D4] bg-transparent py-2 text-[#1A1A1A] outline-none transition-colors placeholder:text-[#A3A3A3] focus:border-[#1A1A1A]"
          />
        </div>

        <PasswordInput id="login-password" />

        <div className="flex items-center justify-between gap-3 text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-[#8A8A8A]">
            <input
              type="checkbox"
              name="remember"
              className="size-3.5 shrink-0 rounded border-[#D4D4D4] accent-[#1A1A1A]"
            />
            Remember for 30 days
          </label>
          <Link
            href="#"
            className="shrink-0 text-[#8A8A8A] transition-colors hover:text-[#1A1A1A]"
          >
            Forgot password?
          </Link>
        </div>

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 w-full rounded-full bg-[#1A1A1A] py-3.5 text-sm font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Logging in…" : "Log In"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-[#8A8A8A] md:mt-10">
        Don&apos;t have an account?{" "}
        <Link
          href="/signup"
          className="font-bold text-[#1A1A1A] transition-opacity hover:opacity-70"
        >
          Sign Up
        </Link>
      </p>
    </div>
  );
}
