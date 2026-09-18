import { Suspense } from "react";
import type { Metadata } from "next";
import { SuccessClient } from "./SuccessClient";

export const metadata: Metadata = {
  title: "Purchase complete",
  description: "Your Twilight Feather purchase confirmation.",
  robots: { index: false, follow: false },
};

export default function SuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-lg px-4 py-24 text-center text-brand-charcoal/70">
          Loading your order…
        </div>
      }
    >
      <SuccessClient />
    </Suspense>
  );
}
