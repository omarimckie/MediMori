"use client";

import { FormEvent, useState } from "react";

type SignupResponse = {
  ok?: boolean;
  discountCode?: string;
  message?: string;
};

const DEFAULT_CODE = "TWILIGHTFEATHER10";

export function EmailSignup() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [discountCode, setDiscountCode] = useState<string>(DEFAULT_CODE);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = (await response.json()) as SignupResponse;

      if (!response.ok || !data.ok) {
        setError(data.message ?? "We could not save your email. Please try again.");
        return;
      }

      setDiscountCode(data.discountCode ?? DEFAULT_CODE);
      setSuccessMessage(
        data.message ?? "You are signed up. Your 10% off code is ready below.",
      );
      setEmail("");
    } catch {
      setError("Could not connect to sign-up service. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm shadow-brand-brown/10 sm:p-8">
        <div className="grid gap-6 md:grid-cols-[1.3fr_1fr] md:items-center">
          <div>
            <p className="text-sm font-extrabold uppercase tracking-wider text-brand-green-deep">
              Join the Twilight.Feather list
            </p>
            <h2 className="mt-2 text-3xl font-extrabold text-brand-charcoal">
              Get 10% off your purchase
            </h2>
            <p className="mt-3 text-brand-charcoal/80">
              Sign up with your email and we will unlock your discount code right
              away. We also send occasional updates when new books are released.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label htmlFor="email" className="text-sm font-semibold text-brand-charcoal">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              className="h-12 rounded-2xl border border-brand-brown/20 bg-white px-4 text-brand-charcoal outline-none ring-brand-green transition focus:ring-2"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-brand-yellow-bright px-5 font-bold text-section-navy transition hover:brightness-95 disabled:cursor-wait disabled:opacity-70"
            >
              {isSubmitting ? "Saving..." : "Get 10% Off"}
            </button>
          </form>
        </div>

        {error ? (
          <p className="mt-4 text-sm font-semibold text-red-600">{error}</p>
        ) : null}

        {successMessage ? (
          <div className="mt-5 rounded-2xl border border-brand-green/25 bg-brand-green/10 p-4">
            <p className="text-sm font-semibold text-brand-charcoal">{successMessage}</p>
            <p className="mt-2 text-lg font-extrabold text-brand-green-deep">
              Discount code: {discountCode}
            </p>
          </div>
        ) : null}
    </div>
  );
}
