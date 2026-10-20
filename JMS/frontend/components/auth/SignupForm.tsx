"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, register } from "@/lib/auth/api";
import { saveSession } from "@/lib/auth/storage";

import { PasswordInput } from "./PasswordInput";

export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");

    try {
      const data = await register({ name, email, password });
      saveSession(
        { access: data.access, refresh: data.refresh },
        data.user,
        true
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
        Create an account
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
            htmlFor="signup-name"
            className="text-sm font-medium text-[#1A1A1A]"
          >
            Name
          </label>
          <input
            id="signup-name"
            name="name"
            type="text"
            autoComplete="name"
            required
            className="w-full border-0 border-b border-[#D4D4D4] bg-transparent py-2 text-[#1A1A1A] outline-none transition-colors placeholder:text-[#A3A3A3] focus:border-[#1A1A1A]"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="signup-email"
            className="text-sm font-medium text-[#1A1A1A]"
          >
            Email
          </label>
          <input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full border-0 border-b border-[#D4D4D4] bg-transparent py-2 text-[#1A1A1A] outline-none transition-colors placeholder:text-[#A3A3A3] focus:border-[#1A1A1A]"
          />
        </div>

        <PasswordInput
          id="signup-password"
          autoComplete="new-password"
        />

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
          {pending ? "Creating account…" : "Sign Up"}
        </button>
      </form>

      <p className="mt-8 text-center text-sm text-[#8A8A8A] md:mt-10">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-bold text-[#1A1A1A] transition-opacity hover:opacity-70"
        >
          Log In
        </Link>
      </p>
    </div>
  );
}
