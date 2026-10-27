"use client";

import Image from "next/image";

type Props = {
  kind: "proxy" | "public-blob" | "legacy";
  src: string;
  alt: string;
  className: string;
  width?: number;
  height?: number;
  fill?: boolean;
  loading?: "lazy" | "eager";
  onError?: () => void;
};

/**
 * Same-origin review images use next/image.
 * Already-public Blob URLs use a plain image so the app does not add a Blob remote pattern
 * or fetch the object through the image optimizer.
 */
export function ReviewPreviewImage({
  kind,
  src,
  alt,
  className,
  width = 800,
  height = 1200,
  fill = false,
  loading = "lazy",
  onError,
}: Props) {
  if (kind === "public-blob") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={className}
        width={fill ? undefined : width}
        height={fill ? undefined : height}
        loading={loading}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={onError}
      />
    );
  }

  if (fill) {
    return <Image src={src} alt={alt} fill className={className} unoptimized onError={onError} />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      unoptimized
      loading={loading}
      onError={onError}
    />
  );
}
