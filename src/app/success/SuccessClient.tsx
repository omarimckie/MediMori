"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

export function SuccessClient() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(async () => {
    if (!sessionId) return;
    setError(null);
    setLoading(true);
    try {
      const url = `/api/download?session_id=${encodeURIComponent(sessionId)}`;
      const res = await fetch(url);
      const contentType = res.headers.get("Content-Type") ?? "";

      if (!res.ok) {
        let message = "Download could not start.";
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          message = `Download failed (${res.status}).`;
        }
        setError(message);
        return;
      }

      if (!contentType.includes("application/pdf")) {
        setError("Unexpected response from server. Please try again.");
        return;
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/i);
      const filename = match?.[1] ?? "medimori-ebook.pdf";

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-2xl font-extrabold text-brand-charcoal">
          Missing order reference
        </h1>
        <p className="mt-3 text-brand-charcoal/80">
          Return to the shop and complete checkout, or use the download link from
          your payment confirmation email if Stripe sent one.
        </p>
        <Link
          href="/#books"
          className="mt-8 inline-flex rounded-2xl bg-brand-green px-6 py-3 font-bold text-white hover:bg-brand-green-deep"
        >
          Back to books
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand-green-deep">
        Thank you
      </p>
      <h1 className="mt-2 text-3xl font-extrabold text-brand-charcoal">
        Your eBook is ready
      </h1>
      <p className="mt-3 text-brand-charcoal/80">
        Click the button below to download your PDF. If anything goes wrong, you
        will see a message on this page instead of a broken tab.
      </p>
      <button
        type="button"
        onClick={download}
        disabled={loading}
        className="mt-10 inline-flex rounded-2xl bg-brand-blue px-8 py-4 text-lg font-bold text-white shadow-md transition hover:bg-brand-blue-deep disabled:cursor-wait disabled:opacity-70"
      >
        {loading ? "Preparing download…" : "Download eBook"}
      </button>
      {error ? (
        <p
          className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm font-medium text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <p className="mt-8 text-sm text-brand-charcoal/60">
        Trouble downloading?{" "}
        <Link href="/#books" className="font-semibold text-brand-green-deep underline">
          Return to the shop
        </Link>
      </p>
    </div>
  );
}
