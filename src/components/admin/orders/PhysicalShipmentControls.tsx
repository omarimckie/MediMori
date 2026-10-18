"use client";

import { SHIPPING_CARRIERS, type ShippingCarrierId } from "@/lib/order-notifications/shipping-carriers";
import { useRouter } from "next/navigation";
import { useState } from "react";

const CARRIERS = Object.entries(SHIPPING_CARRIERS) as Array<
  [ShippingCarrierId, (typeof SHIPPING_CARRIERS)[ShippingCarrierId]]
>;

export function PhysicalShipmentControls({
  kind,
  orderId,
  mode,
  initialCarrier,
  initialTrackingNumber,
  noticeLabel,
  canRetry,
}: {
  kind: string;
  orderId: string;
  mode: "ship" | "correct";
  initialCarrier: string | null;
  initialTrackingNumber: string | null;
  noticeLabel: string | null;
  canRetry: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [carrier, setCarrier] = useState(initialCarrier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(initialTrackingNumber ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(path: string, body: unknown) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        router.push(`/admin/login?next=/admin/orders/${kind}/${orderId}`);
        return;
      }
      const data = (await response.json()) as { error?: string; customerEmail?: string };
      if (!response.ok && response.status !== 202) {
        setError(data.error ?? "Could not save shipment details.");
        return;
      }
      if (data.customerEmail === "failed") {
        setError("Tracking is saved. The customer email did not send.");
      }
      router.refresh();
    } catch {
      setError("Could not save shipment details.");
    } finally {
      setPending(false);
    }
  }

  const trackingReady = carrier !== "" && trackingNumber.trim() !== "";

  return (
    <div className="mt-4 space-y-3">
      {noticeLabel ? <p className="text-sm font-semibold text-brand-charcoal">{noticeLabel}</p> : null}
      {canRetry ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => void submit(`/api/admin/orders/${kind}/${orderId}/shipping-notice`, {})}
          className="inline-flex h-10 items-center rounded-xl border border-brand-brown/20 bg-white px-4 text-sm font-bold text-brand-charcoal disabled:opacity-60"
        >
          {pending ? "Saving…" : "Retry customer email"}
        </button>
      ) : null}
      <label className="block text-xs font-bold uppercase tracking-wide text-brand-charcoal/60" htmlFor={`carrier-${orderId}`}>
        Carrier
        <select
          id={`carrier-${orderId}`}
          value={carrier}
          onChange={(event) => setCarrier(event.target.value)}
          className="mt-1 block h-10 w-full max-w-md rounded-xl border border-brand-brown/20 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-brand-charcoal"
        >
          <option value="">Select a carrier</option>
          {CARRIERS.map(([id, entry]) => (
            <option key={id} value={id}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-bold uppercase tracking-wide text-brand-charcoal/60" htmlFor={`tracking-${orderId}`}>
        Tracking number
        <input
          id={`tracking-${orderId}`}
          value={trackingNumber}
          onChange={(event) => setTrackingNumber(event.target.value)}
          maxLength={80}
          autoComplete="off"
          className="mt-1 block h-10 w-full max-w-md rounded-xl border border-brand-brown/20 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-brand-charcoal"
        />
      </label>
      <button
        type="button"
        disabled={pending || !trackingReady}
        onClick={() =>
          void submit(
            mode === "ship"
              ? `/api/admin/orders/${kind}/${orderId}/ship`
              : `/api/admin/orders/${kind}/${orderId}/shipping-correction`,
            { carrier, trackingNumber },
          )
        }
        className="inline-flex h-10 items-center rounded-xl bg-brand-green-deep px-4 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
      >
        {pending ? "Saving…" : mode === "ship" ? "Mark shipped" : "Update tracking"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
