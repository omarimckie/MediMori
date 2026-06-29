"use client";

import { PersonalSocialLinks } from "@/components/PersonalSocialLinks";
import type { Author } from "@/data/authors";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { useState } from "react";

type Props = {
  authors: Author[];
};

function AuthorPhoto({
  author,
  className = "mx-auto",
}: {
  author: Author;
  className?: string;
}) {
  if (author.photoSrc) {
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

function AuthorSelectorCard({
  author,
  onSelect,
  compact = false,
}: {
  author: Author;
  onSelect: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group w-full cursor-pointer rounded-3xl border border-transparent text-center transition hover:border-brand-blue/20 hover:bg-brand-blue/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-deep ${
        compact ? "p-4" : "p-2"
      }`}
    >
      <motion.div layoutId={`author-photo-${author.name}`}>
        <AuthorPhoto
          author={author}
          className={compact ? "mx-auto max-w-[120px]" : "mx-auto"}
        />
      </motion.div>
      <motion.h2
        layoutId={`author-name-${author.name}`}
        className={`font-extrabold text-brand-blue-deep ${
          compact ? "mt-3 text-lg" : "mt-6 text-2xl sm:text-[1.65rem]"
        }`}
      >
        {author.name}
      </motion.h2>
      {!compact ? (
        <>
          <p className="mt-2 text-sm font-semibold italic text-brand-brown">
            {author.tagline}
          </p>
          <PersonalSocialLinks links={author.socialLinks ?? []} stopLinkPropagation />
          <p className="mt-4 text-xs font-semibold text-brand-charcoal/50 group-hover:text-brand-blue-deep/70">
            Tap to read bio
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs font-semibold text-brand-charcoal/60 group-hover:text-brand-blue-deep">
          View bio
        </p>
      )}
    </button>
  );
}

export function AuthorProfiles({ authors }: Props) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selectedAuthor = authors.find((author) => author.name === selectedName);
  const otherAuthors = authors.filter((author) => author.name !== selectedName);

  return (
    <div>
      <AnimatePresence mode="wait">
        {!selectedAuthor ? (
          <motion.div
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="grid gap-10 md:grid-cols-2 md:gap-12"
          >
            {authors.map((author) => (
              <AuthorSelectorCard
                key={author.name}
                author={author}
                onSelect={() => setSelectedName(author.name)}
              />
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="detail"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="grid gap-8 md:grid-cols-[minmax(240px,0.85fr)_1.15fr] md:items-start md:gap-12">
              <div className="md:text-left">
                <motion.div layoutId={`author-photo-${selectedAuthor.name}`}>
                  <AuthorPhoto author={selectedAuthor} className="md:mx-0" />
                </motion.div>
                <motion.h2
                  layoutId={`author-name-${selectedAuthor.name}`}
                  className="mt-6 text-2xl font-extrabold text-brand-blue-deep sm:text-[1.65rem]"
                >
                  {selectedAuthor.name}
                </motion.h2>
                <p className="mt-2 text-sm font-semibold italic text-brand-brown">
                  {selectedAuthor.tagline}
                </p>
                <PersonalSocialLinks align="start" links={selectedAuthor.socialLinks ?? []} />
              </div>

              <motion.div
                key={selectedAuthor.name}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="flex items-center"
              >
                <p className="text-sm leading-relaxed text-brand-charcoal/85 sm:text-[0.95rem]">
                  {selectedAuthor.bio}
                </p>
              </motion.div>
            </div>

            {otherAuthors.length ? (
              <div className="mt-12 border-t border-brand-brown/15 pt-10">
                <p className="mb-6 text-center text-sm font-semibold text-brand-charcoal/60">
                  Read about our other author
                </p>
                <div className="mx-auto grid max-w-xs gap-4">
                  {otherAuthors.map((author) => (
                    <AuthorSelectorCard
                      key={author.name}
                      author={author}
                      compact
                      onSelect={() => setSelectedName(author.name)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
