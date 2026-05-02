"use client";

import { FormEvent, useState } from "react";

type Props = {
  bookId: string;
  ebookFileBaseName: string;
  isEnabled: boolean;
};

type CheckoutResponse = {
  url?: string;
  error?: string;
};

export function EbookCheckoutForm({ bookId, ebookFileBaseName, isEnabled }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, customerName: name, customerEmail: email }),
      });

      const data = (await response.json()) as CheckoutResponse;
      if (!response.ok || !data.url) {
        setError(data.error ?? "Checkout could not start.");
        return;
      }

      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!isEnabled) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-brand-charcoal/25 bg-cream p-4 text-sm text-brand-charcoal/70">
        eBook checkout is almost ready. Add a Stripe Price ID for this title in{" "}
        <code className="rounded bg-cream-deep px-1">src/data/books.json</code> and
        host the PDF on Vercel Blob (<code className="rounded bg-cream-deep px-1">EBOOK_BLOB_URLS</code>)
        or add{" "}
        <code className="rounded bg-cream-deep px-1">
          private/ebooks/{ebookFileBaseName}.pdf
        </code>{" "}
        for local dev.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 rounded-2xl border border-brand-green/20 bg-brand-green/10 p-4">
      <p className="text-sm font-bold text-brand-charcoal">
        Buy direct eBook (instant download)
      </p>
      <p className="mt-1 text-xs text-brand-charcoal/70">
        Enter your name and email, complete payment, and your download starts on
        the success page.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Full name"
          required
          className="h-11 rounded-xl border border-brand-brown/20 bg-white px-3 text-sm text-brand-charcoal outline-none ring-brand-green focus:ring-2"
        />
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email address"
          required
          className="h-11 rounded-xl border border-brand-brown/20 bg-white px-3 text-sm text-brand-charcoal outline-none ring-brand-green focus:ring-2"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="mt-3 inline-flex h-11 items-center justify-center rounded-xl bg-brand-green px-5 text-sm font-bold text-white transition hover:bg-brand-green-deep disabled:cursor-wait disabled:opacity-70"
      >
        {loading ? "Redirecting to checkout..." : "Buy eBook now"}
      </button>

      {error ? <p className="mt-2 text-sm font-semibold text-red-600">{error}</p> : null}
    </form>
  );
}
