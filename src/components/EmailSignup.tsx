"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";

type SignupResponse = {
  ok?: boolean;
  discountCode?: string;
  message?: string;
};

const DEFAULT_CODE = "TWILIGHTFEATHER10";

// Shown after signup; the same code is enabled on Stripe ebook checkout.

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

      let data: SignupResponse;
      try {
        data = (await response.json()) as SignupResponse;
      } catch {
        setError("We could not save your email. Please try again in a moment.");
        return;
      }

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
    <div id="signup" className="relative overflow-visible rounded-3xl bg-[linear-gradient(120deg,#efe6fb_0%,#f6effc_45%,#fdf6e3_100%)] p-5 sm:p-8">
      <Image
        aria-hidden="true"
        src="/feather-accent.png"
        alt=""
        width={483}
        height={760}
        unoptimized
        className="pointer-events-none absolute -bottom-8 -right-6 hidden w-auto rotate-[10deg] select-none md:block md:h-52 lg:-right-4 lg:h-64"
      />

      <div className="relative rounded-3xl bg-white/95 p-5 shadow-sm shadow-brand-brown/10 md:mr-28 md:p-10 lg:mr-32">
        <span
          aria-hidden="true"
          className="absolute right-3 top-3 text-2xl text-[#7050a5] md:right-6 md:top-5"
        >
          ♥
        </span>

        <div className="grid gap-6 md:grid-cols-[1.3fr_1fr] md:items-center">
          <div>
            <p className="flex items-center gap-2 pr-9 text-sm font-extrabold uppercase tracking-wider text-section-navy md:pr-0">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-5 w-5 text-brand-charcoal/70"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </svg>
              Join the Twilight Feather list
            </p>
            <h2 className="mt-3 text-[2.3rem] font-extrabold leading-tight text-section-navy">
              Get 10% off your eBook purchase
            </h2>
            <p className="mt-3 text-[1.0625rem] leading-relaxed text-brand-charcoal/80 sm:text-lg">
              Sign up with your email and we&apos;ll send you exclusive deals,
              new books, and resources.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label htmlFor="email" className="sr-only">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email address"
              required
              className="h-12 min-h-12 rounded-2xl border border-brand-brown/20 bg-white px-4 text-base text-brand-charcoal outline-none ring-brand-green transition focus:ring-2"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-12 min-h-12 items-center justify-center rounded-2xl bg-brand-yellow-bright px-5 font-bold text-section-navy transition hover:brightness-95 disabled:cursor-wait disabled:opacity-70"
            >
              {isSubmitting ? "Saving..." : "Get 10% Off"}
            </button>
            <p className="text-xs leading-relaxed text-brand-charcoal/55">
              10% off eBook purchases only.
            </p>
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
            <p className="mt-2 text-xs text-brand-charcoal/70">
              Enter this code in the promotion field when you buy an eBook on
              this site.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
