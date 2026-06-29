import Image from "next/image";

type Props = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  maxWidthClass?: string;
  className?: string;
  priority?: boolean;
};

export function BookCoverImage({
  src,
  alt,
  width = 700,
  height = 1000,
  maxWidthClass = "max-w-[220px]",
  className = "",
  priority = false,
}: Props) {
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      className={`h-auto w-full rounded-2xl border border-brand-brown/20 bg-white shadow-sm ${maxWidthClass} ${className}`.trim()}
    />
  );
}
