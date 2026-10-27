"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ShippingTestEmailControl({
  kind,
  orderId,
  enabled,
}: {
  kind: string;
  orderId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendTest() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/orders/${kind}/${orderId}/shipping-test-notice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (response.status === 401) {
        router.push(`/admin/login?next=/admin/orders/${kind}/${orderId}`);
        return;
      }
      const data = (await response.json()) as { outcome?: string; error?: string };
      if (data.outcome === "accepted") {
        setMessage("Test email accepted. No package was shipped. This order is still awaiting shipment.");
      } else if (data.outcome === "already_attempted") {
        setMessage("A test email was already attempted. No second email was sent.");
      } else if (data.outcome === "ambiguous") {
        setMessage("The test email outcome is uncertain. No second email will be sent.");
      } else if (data.outcome === "disabled") {
        setError("This test is turned off.");
      } else if (data.outcome === "unavailable") {
        setError(data.error ?? "No email was sent. Live send is not activated.");
      } else {
        setError(data.error ?? "The test email was rejected.");
      }
      router.refresh();
    } catch {
      setError("The test email outcome is uncertain. No second email will be sent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-3xl border border-amber-300 bg-amber-50 p-6">
      <h2 className="text-lg font-extrabold text-brand-charcoal">Test email only</h2>
      <p className="mt-2 text-sm text-brand-charcoal">
        This sends one test message to the checkout email already stored on this order. It does not
        mark the book shipped and does not create a carrier or tracking number.
      </p>
      <label className="mt-4 flex items-start gap-2 text-sm text-brand-charcoal">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={!enabled || pending}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>I understand this is a test email and no package will be shipped.</span>
      </label>
      <button
        type="button"
        disabled={!enabled || !confirmed || pending}
        onClick={() => void sendTest()}
        className="mt-4 inline-flex h-10 items-center rounded-xl border border-amber-400 bg-white px-4 text-sm font-bold text-brand-charcoal disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send TEST email — no package shipped"}
      </button>
      {!enabled ? (
        <p className="mt-3 text-sm text-brand-charcoal">
          This test is turned off. A live send also needs the one-send record, which is not available yet.
        </p>
      ) : null}
      {message ? <p className="mt-3 text-sm font-semibold text-brand-charcoal">{message}</p> : null}
      {error ? <p className="mt-3 text-sm font-semibold text-red-700">{error}</p> : null}
    </section>
  );
}
