"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { contentBodyExcerpt } from "@/lib/marketing/content-client-utils";
import type { SmartUploadPairResolution } from "@/lib/marketing/content-assign-week";
import { resolveReviewCardImageSrc } from "@/lib/marketing/content-queue-review";
import { ReviewPreviewImage } from "./ReviewPreviewImage";
import { PrimaryButton, SecondaryButton } from "./ui";

type AddToPlannerModalProps = {
  open: boolean;
  busy: boolean;
  anchorContentId: string;
  anchorTitle: string | null;
  anchorBody: string;
  previewUrl: string | null;
  allowPublicBlobPreview?: boolean;
  onClose: () => void;
  onConfirm: (input: { contentIds: string[] }) => void;
};

export function AddToPlannerModal({
  open,
  busy,
  anchorContentId,
  anchorTitle,
  anchorBody,
  previewUrl,
  allowPublicBlobPreview = false,
  onClose,
  onConfirm,
}: AddToPlannerModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [pair, setPair] = useState<SmartUploadPairResolution | null>(null);
  const [pairLoading, setPairLoading] = useState(false);
  const [includeInstagram, setIncludeInstagram] = useState(true);
  const [includeFacebook, setIncludeFacebook] = useState(true);
  const [includePinterest, setIncludePinterest] = useState(true);

  useEffect(() => {
    if (!open) return;
    setIncludeInstagram(true);
    setIncludeFacebook(true);
    setIncludePinterest(true);
    setPair(null);
    setPairLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/marketing/content/smart-upload-pair?contentId=${encodeURIComponent(anchorContentId)}`,
        );
        if (res.ok) {
          const json = (await res.json()) as { pair: SmartUploadPairResolution };
          setPair(json.pair);
        }
      } finally {
        setPairLoading(false);
      }
    })();
  }, [open, anchorContentId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  const previewImage = resolveReviewCardImageSrc(previewUrl, allowPublicBlobPreview);

  if (!open) return null;

  const completePair = pair?.kind === "complete" ? pair : null;
  const pairWarning = pair?.kind === "partial_or_inconsistent" ? pair.message : null;

  function selectedContentIds(): string[] {
    if (completePair) {
      const ids: string[] = [];
      if (includeInstagram && completePair.instagramId) ids.push(completePair.instagramId);
      if (includeFacebook && completePair.facebookId) ids.push(completePair.facebookId);
      if (includePinterest && completePair.pinterestId) ids.push(completePair.pinterestId);
      return ids;
    }
    return [anchorContentId];
  }

  const canSubmit = selectedContentIds().length > 0 && !busy && !pairLoading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-brand-navy/40 p-4"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-xl outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 id={titleId} className="text-lg font-extrabold text-brand-navy">
          Add to Planner
        </h3>
        <p className="mt-2 text-sm text-brand-charcoal/75">
          Adds approved content to the planning queue. Choose the publishing week, platforms, and
          schedule later on the{" "}
          <Link href="/admin/marketing/calendar#planning-queue" className="font-bold text-brand-navy underline">
            Calendar
          </Link>
          .
        </p>

        <div className="mt-4 flex gap-3">
          {previewImage ? (
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-brand-brown/15 bg-cream-deep">
              <ReviewPreviewImage
                kind={previewImage.kind}
                src={previewImage.src}
                alt=""
                fill={previewImage.kind !== "public-blob"}
                className={
                  previewImage.kind === "public-blob"
                    ? "h-full w-full object-cover"
                    : "object-cover"
                }
              />
            </div>
          ) : null}
          <div className="min-w-0">
            <p className="text-sm font-bold text-brand-navy">{anchorTitle || "Untitled"}</p>
            <p className="mt-1 text-xs text-brand-charcoal/70">{contentBodyExcerpt(anchorBody, 140)}</p>
          </div>
        </div>

        {pairLoading ? (
          <p className="mt-3 text-xs text-brand-charcoal/55" role="status">
            Checking Smart Upload pair…
          </p>
        ) : null}
        {completePair ? (
          <fieldset className="mt-4 space-y-2">
            <legend className="text-sm font-bold">Platforms</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeInstagram}
                onChange={(e) => setIncludeInstagram(e.target.checked)}
              />
              Instagram
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeFacebook}
                onChange={(e) => setIncludeFacebook(e.target.checked)}
              />
              Facebook
            </label>
            {completePair.pinterestId ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includePinterest}
                  onChange={(e) => setIncludePinterest(e.target.checked)}
                />
                Pinterest
              </label>
            ) : null}
            {!includeInstagram && !includeFacebook && !includePinterest ? (
              <p className="text-xs font-semibold text-brand-orange-deep">
                Select at least one platform.
              </p>
            ) : null}
          </fieldset>
        ) : null}
        {pairWarning ? (
          <p className="mt-3 text-xs text-brand-charcoal/60" role="status">
            {pairWarning}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <SecondaryButton type="button" disabled={busy} onClick={onClose}>
            Cancel
          </SecondaryButton>
          <PrimaryButton
            type="button"
            disabled={!canSubmit}
            onClick={() => onConfirm({ contentIds: selectedContentIds() })}
          >
            Add to Planner
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
