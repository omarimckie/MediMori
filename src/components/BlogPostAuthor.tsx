import type { Author } from "@/lib/authors";
import { getAuthorProfileHref } from "@/lib/authors";
import Image from "next/image";
import Link from "next/link";

type Props = {
  author: Author;
  variant?: "compact" | "detail";
  tone?: "light" | "dark";
  shared?: boolean;
};

export function BlogPostAuthor({
  author,
  variant = "compact",
  tone = "light",
  shared = false,
}: Props) {
  const href = getAuthorProfileHref(author.id);
  const isDark = tone === "dark";
  const prefix = shared ? "Shared by " : "By ";

  const linkClass =
    variant === "detail"
      ? "group flex items-center gap-4 rounded-2xl border border-brand-brown/15 bg-cream-deep p-4 transition hover:border-brand-blue/25 hover:bg-white"
      : "group inline-flex items-center gap-2 transition";

  const nameClass =
    variant === "detail"
      ? "text-base font-extrabold text-brand-charcoal group-hover:text-brand-blue-deep"
      : `text-xs font-bold ${isDark ? "text-white/90 group-hover:text-white" : "text-brand-charcoal/80 group-hover:text-brand-blue-deep"}`;

  return (
    <Link href={href} className={linkClass}>
      {author.photoSrc ? (
        <span
          className={`relative shrink-0 overflow-hidden rounded-full border ${
            isDark ? "border-white/25" : "border-brand-brown/20"
          } ${variant === "detail" ? "h-14 w-14" : "h-7 w-7"}`}
        >
          <Image
            src={author.photoSrc}
            alt=""
            width={variant === "detail" ? 56 : 28}
            height={variant === "detail" ? 56 : 28}
            className={`h-full w-full ${author.photoFit === "contain" ? "object-contain bg-white" : "object-cover"}`}
          />
        </span>
      ) : null}

      <span className="min-w-0">
        <span className={nameClass}>
          {variant === "compact" ? prefix : shared ? "Shared by " : ""}
          {author.name}
        </span>
        {variant === "detail" ? (
          <p className="mt-0.5 text-sm text-brand-charcoal/65">
            {shared
              ? "Curated link share — we did not write the original article."
              : author.tagline}
          </p>
        ) : null}
      </span>
    </Link>
  );
}
