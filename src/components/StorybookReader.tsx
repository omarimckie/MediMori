"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Props = {
  bookId: string;
  title: string;
  totalPages: number;
  availablePages: number[];
  sample: boolean;
};

export function StorybookReader({
  bookId,
  title,
  totalPages,
  availablePages,
  sample,
}: Props) {
  const pages = useMemo(
    () => [...availablePages].sort((a, b) => a - b),
    [availablePages],
  );
  const [index, setIndex] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const page = pages[index] ?? pages[0];
  const canPrev = index > 0;
  const canNext = index < pages.length - 1;

  const loadPage = useCallback(
    async (pageNumber: number, signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/reader/page?bookId=${encodeURIComponent(bookId)}&page=${pageNumber}`,
          { cache: "no-store", signal },
        );
        if (res.status === 401 || res.status === 403) {
          window.location.href = "/library";
          return;
        }
        const data = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !data.url) {
          setError(data.error || "Could not load this page.");
          setImageUrl(null);
          return;
        }
        setImageUrl(data.url);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setError("Network error. Try again.");
        setImageUrl(null);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [bookId],
  );

  useEffect(() => {
    if (!page) return;
    const controller = new AbortController();
    void loadPage(page, controller.signal);
    return () => controller.abort();
  }, [loadPage, page]);

  const goPrev = useCallback(() => {
    setIndex((current) => Math.max(0, current - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((current) => Math.min(pages.length - 1, current + 1));
  }, [pages.length]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNext, goPrev]);

  useEffect(() => {
    function onFullscreenChange() {
      const node = stageRef.current;
      setIsFullscreen(
        Boolean(node && document.fullscreenElement === node),
      );
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    const node = stageRef.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await node.requestFullscreen();
    } catch (error) {
      console.error("Could not toggle full screen:", error);
    }
  }

  function onTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.changedTouches[0]?.clientX ?? null;
  }

  function onTouchEnd(event: React.TouchEvent) {
    const start = touchStartX.current;
    const end = event.changedTouches[0]?.clientX;
    touchStartX.current = null;
    if (start == null || end == null) return;
    const delta = end - start;
    if (Math.abs(delta) < 48) return;
    if (delta > 0) goPrev();
    else goNext();
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-10">
      <p className="text-sm font-semibold text-brand-green-deep">
        <Link href="/library" className="underline-offset-2 hover:underline">
          My Books
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-extrabold text-brand-charcoal sm:text-3xl">
        {title}
      </h1>
      {sample ? (
        <p className="mt-3 rounded-2xl border border-brand-brown/20 bg-white px-4 py-3 text-sm text-brand-charcoal/80">
          Sample reader: {pages.length} of {totalPages} pages are available for
          visual review. The original PDF is not included.
        </p>
      ) : null}

      <div
        ref={stageRef}
        className={
          isFullscreen
            ? "flex h-full flex-col bg-[#f3ead4] p-4 sm:p-6"
            : "mt-6"
        }
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className={
            isFullscreen
              ? "mx-auto flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-3xl border border-brand-brown/15 bg-white"
              : "mx-auto w-full max-w-[min(100%,56rem)] overflow-hidden rounded-3xl border border-brand-brown/15 bg-white shadow-[0_8px_24px_rgba(31,42,68,0.06)]"
          }
        >
          {imageUrl ? (
            // Native img: signed private Blob URL must not go through public image optimization.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={`Page ${page} of ${totalPages}`}
              width={1577}
              height={1600}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              className={
                isFullscreen
                  ? "max-h-full max-w-full select-none object-contain"
                  : "h-auto w-full select-none object-contain"
              }
            />
          ) : (
            <div className="flex min-h-64 items-center justify-center px-6 py-24 text-center text-sm text-brand-charcoal/70">
              {loading ? "Loading page…" : error || "Page unavailable."}
            </div>
          )}
        </div>
        {loading && imageUrl ? (
          <p className="mt-2 text-center text-xs text-brand-charcoal/60">
            Loading page…
          </p>
        ) : null}
        {error && imageUrl ? (
          <p className="mt-2 text-center text-sm text-red-800" role="alert">
            {error}
          </p>
        ) : null}

        <nav
          className="mt-4 flex flex-wrap items-center justify-between gap-3 sm:mt-6"
          aria-label="Story pages"
        >
          <button
            type="button"
            onClick={goPrev}
            disabled={!canPrev}
            aria-label="Previous page"
            className="tf-btn tf-btn-secondary min-w-[8.5rem] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <p
            className="text-sm font-bold text-brand-charcoal"
            aria-live="polite"
          >
            Page {page} of {totalPages}
          </p>
          <button
            type="button"
            onClick={goNext}
            disabled={!canNext}
            aria-label="Next page"
            className="tf-btn tf-btn-primary min-w-[8.5rem] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </nav>

        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={
              isFullscreen ? "Exit full screen" : "View page in full screen"
            }
            className="tf-btn tf-btn-ghost"
          >
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>
    </div>
  );
}
