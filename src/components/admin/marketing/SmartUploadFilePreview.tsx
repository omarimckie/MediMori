"use client";

import { useEffect, useMemo, useState } from "react";
import {
  resolveSmartUploadStagedListPreviewSrc,
  shouldUseSmartUploadLocalFilePreview,
} from "@/lib/marketing/smart-upload-list-preview";

type SmartUploadFilePreviewProps = {
  file: File;
  pathname: string | null;
  uploadIntent: string | null;
};

export function SmartUploadFilePreview({
  file,
  pathname,
  uploadIntent,
}: SmartUploadFilePreviewProps) {
  const stagedSrc = useMemo(
    () => resolveSmartUploadStagedListPreviewSrc({ pathname, uploadIntent }),
    [pathname, uploadIntent],
  );
  const useLocalPreview = shouldUseSmartUploadLocalFilePreview({ pathname, uploadIntent });
  const localSrc = useMemo(() => {
    if (!useLocalPreview) return null;
    return URL.createObjectURL(file);
  }, [file, useLocalPreview]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!localSrc) return;
    return () => URL.revokeObjectURL(localSrc);
  }, [localSrc]);

  const src = stagedSrc ?? localSrc;
  if (!src) return null;

  return (
    <div className="mt-2">
      <p className="mb-1 text-xs font-bold text-brand-charcoal/70">Upload preview</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- admin-only staged blob / object URL preview */}
      <img
        src={src}
        alt="Upload preview"
        className="max-h-48 w-full max-w-sm rounded-lg border border-brand-brown/15 bg-white object-contain"
        onLoad={() => setLoadError(null)}
        onError={() =>
          setLoadError(
            stagedSrc
              ? "Could not load the staged image preview. Re-validate the upload or try again."
              : "Could not load this image file in the browser.",
          )
        }
      />
      {loadError ? (
        <p className="mt-1 text-xs font-semibold text-brand-orange-deep" role="alert">
          {loadError}
        </p>
      ) : null}
    </div>
  );
}
