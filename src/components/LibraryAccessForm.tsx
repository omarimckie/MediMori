"use client";

import { useState } from "react";

export function LibraryAccessForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [localAccessUrl, setLocalAccessUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    setLocalAccessUrl(null);

    try {
      const res = await fetch("/api/library/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        localAccessUrl?: string;
      };
      if (!res.ok) {
        setError(data.error || "Could not send the access email.");
        return;
      }
      setMessage(
        data.message ||
          "If that email owns Twilight Feather books, we sent a one-time access link.",
      );
      if (typeof data.localAccessUrl === "string" && data.localAccessUrl) {
        setLocalAccessUrl(data.localAccessUrl);
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-8 max-w-md text-left">
      <label htmlFor="library-email" className="sr-only">
        Email address
      </label>
      <input
        id="library-email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Email used at checkout"
        autoComplete="email"
        required
        className="h-12 w-full rounded-xl border border-brand-brown/20 bg-white px-3 text-sm text-brand-charcoal outline-none ring-brand-green focus:ring-2"
      />
      <button
        type="submit"
        disabled={loading}
        className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-brand-blue-deep px-6 py-3 text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-wait disabled:opacity-70"
      >
        {loading ? "Sending…" : "Email me an access link"}
      </button>
      {message ? (
        <p className="mt-4 rounded-2xl border border-brand-green/30 bg-brand-green/10 px-4 py-3 text-sm text-brand-charcoal">
          {message}
        </p>
      ) : null}
      {localAccessUrl ? (
        <p className="mt-3 text-sm">
          <a
            href={localAccessUrl}
            className="font-bold text-brand-green-deep underline"
          >
            Open my books
          </a>
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
