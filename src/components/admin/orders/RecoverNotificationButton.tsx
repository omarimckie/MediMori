"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RecoverNotificationButton({
  kind,
  orderId,
}: {
  kind: string;
  orderId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("Manual notification recovery");

  async function recover() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/admin/orders/${kind}/${orderId}/notification-recovery`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      if (response.status === 401) {
        router.push(`/admin/login?next=/admin/orders/${kind}/${orderId}`);
        return;
      }
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not recover this notification.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not recover this notification.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4">
      <label className="block text-xs font-bold uppercase tracking-wide text-brand-charcoal/60">
        Recovery reason
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={pending}
          className="mt-1 block h-10 w-full rounded-xl border border-brand-brown/20 px-3 text-sm font-semibold normal-case tracking-normal text-brand-charcoal"
        />
      </label>
      <button
        type="button"
        onClick={() => void recover()}
        disabled={pending || reason.trim().length === 0}
        className="mt-3 inline-flex h-10 items-center rounded-xl bg-brand-green-deep px-4 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
      >
        {pending ? "Recovering…" : "Recover notification"}
      </button>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
