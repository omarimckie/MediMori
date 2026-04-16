import { Suspense } from "react";
import { SuccessClient } from "./SuccessClient";

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
