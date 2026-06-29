"use client";

import { useEffect, useState } from "react";

type Props = {
  url: string;
  title: string;
};

function buildFacebookShareUrl(url: string) {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
}

function buildTwitterShareUrl(url: string, title: string) {
  const params = new URLSearchParams({
    url,
    text: title,
  });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export function BlogShareActions({ url, title }: Props) {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && "share" in navigator);
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  async function nativeShare() {
    if (!navigator.share) return;

    try {
      await navigator.share({ title, url });
    } catch {
      // User cancelled or share failed — no action needed.
    }
  }

  const shareButtonClass =
    "inline-flex h-10 items-center justify-center rounded-xl border border-brand-brown/20 bg-white px-4 text-sm font-bold text-brand-charcoal transition hover:bg-cream-deep";

  return (
    <div className="rounded-2xl border border-brand-brown/15 bg-cream-deep p-4">
      <p className="text-sm font-bold text-brand-charcoal">Share this post</p>
      <p className="mt-1 text-xs text-brand-charcoal/70">
        Publish on the blog first, then share the link on Instagram or Facebook.
        No account connection required.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={copyLink} className={shareButtonClass}>
          {copied ? "Link copied!" : "Copy link"}
        </button>

        {canNativeShare ? (
          <button type="button" onClick={nativeShare} className={shareButtonClass}>
            Share…
          </button>
        ) : null}

        <a
          href={buildFacebookShareUrl(url)}
          target="_blank"
          rel="noopener noreferrer"
          className={shareButtonClass}
        >
          Facebook
        </a>

        <a
          href={buildTwitterShareUrl(url, title)}
          target="_blank"
          rel="noopener noreferrer"
          className={shareButtonClass}
        >
          X / Twitter
        </a>
      </div>

      <p className="mt-3 break-all text-xs text-brand-charcoal/55">{url}</p>
    </div>
  );
}
