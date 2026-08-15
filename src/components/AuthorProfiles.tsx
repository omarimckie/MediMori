"use client";

import { PersonalSocialLinks } from "@/components/PersonalSocialLinks";
import type { Author } from "@/data/authors";
import Image from "next/image";
import { useEffect, useState } from "react";

type Props = {
  authors: Author[];
  initialAuthorId?: string;
};

function AuthorPhoto({
  author,
  className = "mx-auto",
}: {
  author: Author;
  className?: string;
}) {
  if (author.photoSrc) {
    if (author.photoFit === "contain") {
      const width = author.photoWidth ?? 220;
      const height = author.photoHeight ?? 220;

      return (
        <Image
          src={author.photoSrc}
          alt={author.photoAlt ?? `${author.name} headshot`}
          width={width}
          height={height}
          className={`h-auto w-full rounded-2xl border border-brand-brown/20 shadow-sm ${
            className.includes("max-w-") ? className : `mx-auto max-w-[220px] ${className}`
          }`}
        />
      );
    }

    return (
      <div
        className={`aspect-square w-full max-w-[220px] overflow-hidden rounded-2xl border border-brand-brown/20 bg-white shadow-sm ${className}`}
      >
        <Image
          src={author.photoSrc}
          alt={author.photoAlt ?? `${author.name} headshot`}
          width={220}
          height={220}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={`flex aspect-square w-full max-w-[220px] items-center justify-center rounded-2xl border-2 border-dashed border-brand-brown/30 bg-brand-charcoal/[0.03] text-sm font-medium text-brand-charcoal/45 ${className}`}
    >
      Author Photo
    </div>
  );
}

export function AuthorProfiles({ authors, initialAuthorId }: Props) {
  const validInitialId = authors.some((author) => author.id === initialAuthorId)
    ? initialAuthorId
    : undefined;
  const [openId, setOpenId] = useState<string | null>(validInitialId ?? null);

  useEffect(() => {
    if (validInitialId) {
      setOpenId(validInitialId);
    }
  }, [validInitialId]);

  return (
    <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2 md:gap-8 lg:gap-10">
      {authors.map((author) => {
        const isOpen = openId === author.id;
        const bioId = `${author.id}-bio`;

        return (
          <div key={author.id} className="text-center">
            <div className="group w-full rounded-3xl border border-transparent p-2 text-center transition hover:border-brand-blue/20 hover:bg-brand-blue/[0.04]">
              <button
                type="button"
                onClick={() =>
                  setOpenId((current) => (current === author.id ? null : author.id))
                }
                aria-expanded={isOpen}
                aria-controls={author.bio ? bioId : undefined}
                className="w-full cursor-pointer text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-deep"
              >
                <AuthorPhoto author={author} className="mx-auto" />
                <h2 className="mt-6 text-2xl font-extrabold text-brand-blue-deep sm:text-[1.65rem]">
                  {author.name}
                </h2>
                <p className="mt-2 text-sm font-semibold italic text-brand-brown">
                  {author.tagline}
                </p>
              </button>
              <PersonalSocialLinks links={author.socialLinks ?? []} />
              {author.bio ? (
                <button
                  type="button"
                  onClick={() =>
                    setOpenId((current) => (current === author.id ? null : author.id))
                  }
                  aria-expanded={isOpen}
                  aria-controls={bioId}
                  className="mt-4 w-full cursor-pointer text-xs font-semibold text-brand-charcoal/50 group-hover:text-brand-blue-deep/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-deep"
                >
                  Tap to read bio
                </button>
              ) : null}
            </div>

            {isOpen && author.bio ? (
              <p
                id={bioId}
                className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-brand-charcoal/85 sm:text-[0.95rem]"
              >
                {author.bio}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
