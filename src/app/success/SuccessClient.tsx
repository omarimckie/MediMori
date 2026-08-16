"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

export function SuccessClient() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readerOnly, setReaderOnly] = useState(false);

  const download = useCallback(async () => {
    if (!sessionId) return;
    setError(null);
    setReaderOnly(false);
    setLoading(true);
    try {
      const url = `/api/download?session_id=${encodeURIComponent(sessionId)}`;
      const res = await fetch(url, { redirect: "manual" });

      // Cross-origin 302 to Vercel Blob is an opaque redirect (status 0).
      // Navigate to the API URL so the browser follows the signed download.
      if (res.type === "opaqueredirect" || res.status === 0) {
        window.location.assign(url);
        return;
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("Location");
        if (!location) {
          setError("Download could not start.");
          return;
        }
        window.location.assign(location);
        return;
      }

      if (!res.ok) {
        let message = "Download could not start.";
        let isReaderOnly = false;
        try {
          const data = (await res.json()) as {
            error?: string;
            readerOnly?: boolean;
          };
          if (data.error) message = data.error;
          isReaderOnly = data.readerOnly === true;
        } catch {
          message = `Download failed (${res.status}).`;
        }
        setReaderOnly(isReaderOnly);
        setError(message);
        return;
      }

      setError("Unexpected response from server. Please try again.");
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
          href="/books"
          className="mt-8 inline-flex rounded-2xl bg-brand-green-deep px-6 py-3 font-bold text-white hover:brightness-95"
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
        Storybooks open in My Books. Word Search downloads as a PDF.
      </p>
      {readerOnly ? (
        <Link
          href="/library"
          className="mt-10 inline-flex rounded-2xl bg-brand-blue-deep px-8 py-4 text-lg font-bold text-white shadow-md transition hover:brightness-95"
        >
          Open My Books
        </Link>
      ) : (
        <button
          type="button"
          onClick={download}
          disabled={loading}
          className="mt-10 inline-flex rounded-2xl bg-brand-blue-deep px-8 py-4 text-lg font-bold text-white shadow-md transition hover:brightness-95 disabled:cursor-wait disabled:opacity-70"
        >
          {loading ? "Preparing download…" : "Download eBook"}
        </button>
      )}
      {error ? (
        <p
          className={
            readerOnly
              ? "mt-6 rounded-2xl border border-brand-green/30 bg-brand-green/10 px-4 py-3 text-left text-sm font-medium text-brand-charcoal"
              : "mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-left text-sm font-medium text-red-800"
          }
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <p className="mt-8 text-sm text-brand-charcoal/60">
        {readerOnly ? (
          <>
            Open{" "}
            <Link href="/library" className="font-semibold text-brand-green-deep underline">
              My Books
            </Link>{" "}
            to read this storybook.
          </>
        ) : (
          <>
            Trouble downloading?{" "}
            <Link href="/books" className="font-semibold text-brand-green-deep underline">
              Return to the shop
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
