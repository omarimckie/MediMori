"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type Props = {
  bookId: string;
  ebookFileBaseName: string;
  isEnabled: boolean;
  /** When physical paperback is primary, use a compact layout below the eBook heading. */
  variant?: "default" | "secondary";
};

type CheckoutResponse = {
  url?: string;
  error?: string;
  newsletterPromotionAvailable?: boolean;
};

export function EbookCheckoutForm({
  bookId,
  ebookFileBaseName,
  isEnabled,
  variant = "default",
}: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promotionNote, setPromotionNote] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPromotionNote(null);
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

      if (data.newsletterPromotionAvailable === false) {
        setPromotionNote(
          "The newsletter 10% offer has already been used on this email. You can still check out at full price.",
        );
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
      <div className="rounded-2xl border border-dashed border-brand-charcoal/25 bg-cream p-4 text-sm text-brand-charcoal/70">
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

  const secondary = variant === "secondary";

  return (
    <form
      id="purchase"
      onSubmit={onSubmit}
      className={
        secondary
          ? "scroll-mt-24"
          : "scroll-mt-24 rounded-2xl border border-brand-green/20 bg-brand-green/10 p-4"
      }
    >
      {!secondary ? (
        <>
          <p className="text-sm font-bold text-brand-charcoal">Buy direct eBook</p>
          <p className="mt-1 text-xs text-brand-charcoal/70">
            Enter your name and email, then complete payment. Email subscribers
            receive 10% off eligible direct purchases on this site (Amazon excluded).
          </p>
        </>
      ) : (
        <p className="text-xs text-brand-charcoal/70">
          Enter your name and email to complete payment. Email subscribers receive
          10% off eligible direct purchases on this site (Amazon excluded).
        </p>
      )}

      <div className={secondary ? "mt-3 grid gap-3 sm:grid-cols-2" : "mt-4 grid gap-3 sm:grid-cols-2"}>
        <div>
          <label htmlFor="ebook-customer-name" className="sr-only">
            Full name
          </label>
          <input
            id="ebook-customer-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Full name"
            autoComplete="name"
            required
            className="h-11 w-full rounded-xl border border-brand-brown/20 bg-white px-3 text-sm text-brand-charcoal outline-none ring-brand-green focus:ring-2"
          />
        </div>
        <div>
          <label htmlFor="ebook-customer-email" className="sr-only">
            Email address
          </label>
          <input
            id="ebook-customer-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email address"
            autoComplete="email"
            required
            className="h-11 w-full rounded-xl border border-brand-brown/20 bg-white px-3 text-sm text-brand-charcoal outline-none ring-brand-green focus:ring-2"
          />
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-brand-charcoal/70">
        Your name and email are used to process your purchase and provide access
        to your Twilight Feather Books library.
      </p>

      <p className="mt-3 text-xs leading-relaxed text-brand-charcoal/70">
        {bookId === "book-two" ? (
          <>
            After purchase, your Word Search PDF is available in your Twilight
            Feather Books library. You can download it whenever you need it.
          </>
        ) : (
          <>
            Digital eBook: This book is available to read online through your
            Twilight Feather Books library. It is not available for offline
            download.
          </>
        )}{" "}
        Refunds are limited and generally unavailable after the content has been
        accessed or downloaded. See our{" "}
        <Link
          href="/refund-policy"
          className="font-semibold text-brand-green-deep underline underline-offset-2"
        >
          Refund Policy
        </Link>{" "}
        for details.
      </p>

      <button
        type="submit"
        disabled={loading}
        className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-green-deep px-5 text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-wait disabled:opacity-70"
      >
        {loading ? "Redirecting to checkout..." : "Buy eBook now"}
      </button>

      {promotionNote ? (
        <p className="mt-2 text-sm text-brand-charcoal/80">{promotionNote}</p>
      ) : null}
      {error ? <p className="mt-2 text-sm font-semibold text-red-600">{error}</p> : null}
    </form>
  );
}
