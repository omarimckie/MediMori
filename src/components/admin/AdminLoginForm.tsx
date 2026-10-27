"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

type Props = {
  configured: boolean;
};

export function AdminLoginForm({ configured }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Login failed.");
        return;
      }

      const next = searchParams.get("next") || "/admin";
      router.push(next);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-section-navy px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white p-8 shadow-xl">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
          Twilight.Feather
        </p>
        <h1 className="mt-2 text-3xl font-extrabold text-brand-charcoal">Blog admin</h1>
        <p className="mt-2 text-sm text-brand-charcoal/75">
          Sign in to create and publish blog posts directly on the site.
        </p>

        {!configured ? (
          <p className="mt-6 rounded-2xl border border-dashed border-brand-brown/25 bg-cream p-4 text-sm text-brand-charcoal/75">
            Admin login is not configured yet. Add{" "}
            <code className="rounded bg-cream-deep px-1">ADMIN_USERS</code> and{" "}
            <code className="rounded bg-cream-deep px-1">ADMIN_SESSION_SECRET</code>{" "}
            to your environment.
          </p>
        ) : null}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-brand-charcoal">Username</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              className="mt-1 h-11 w-full rounded-xl border border-brand-brown/20 bg-white px-3 text-sm text-brand-charcoal outline-none ring-brand-green focus:ring-2"
            />
          </label>

          <label className="block">
            <span className="text-sm font-bold text-brand-charcoal">Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              className="mt-1 h-11 w-full rounded-xl border border-brand-brown/20 bg-white px-3 text-sm text-brand-charcoal outline-none ring-brand-green focus:ring-2"
            />
          </label>

          {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

          <button
            type="submit"
            disabled={loading || !configured}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-green-deep px-5 text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
