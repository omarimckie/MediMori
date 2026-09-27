"use client";

import { FormEvent, useState } from "react";

type Props = {
  bookId: string;
  disabled?: boolean;
};

type CheckoutResponse = {
  url?: string;
  error?: string;
};

export function PhysicalCheckoutForm({ bookId, disabled = false }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/checkout/physical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, quantity }),
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

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <label className="grid gap-1 text-sm font-semibold text-brand-charcoal">
        Quantity
        <select
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
          disabled={disabled || loading}
          className="h-11 rounded-xl border border-brand-brown/20 bg-white px-3 text-sm font-medium text-brand-charcoal"
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={disabled || loading}
        className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-brand-green-deep px-5 text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Redirecting…" : "Buy paperback directly"}
      </button>
      {error ? (
        <p className="text-sm font-medium text-red-700" role="alert">{error}</p>
      ) : null}
    </form>
  );
}
