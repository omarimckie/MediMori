"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function MarkShippedButton({
  kind,
  orderId,
}: {
  kind: string;
  orderId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markShipped() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/orders/${kind}/${orderId}/ship`, {
        method: "POST",
      });
      if (response.status === 401) {
        router.push(`/admin/login?next=/admin/orders/${kind}/${orderId}`);
        return;
      }
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not mark this order shipped.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not mark this order shipped.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => void markShipped()}
        disabled={pending}
        className="inline-flex h-10 items-center rounded-xl bg-brand-green-deep px-4 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Mark shipped"}
      </button>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
