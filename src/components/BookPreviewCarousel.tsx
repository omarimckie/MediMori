"use client";

import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Slide = {
  src: string;
  alt: string;
  label: string;
};

type Props = {
  title: string;
  coverImageUrl?: string;
  insideImageUrls?: string[];
  className?: string;
  maxWidth?: string;
};

export function BookPreviewCarousel({
  title,
  coverImageUrl,
  insideImageUrls = [],
  className = "",
  maxWidth = "max-w-[220px]",
}: Props) {
  const slides = useMemo(() => {
    const items: Slide[] = [];

    if (coverImageUrl) {
      items.push({ src: coverImageUrl, alt: `${title} cover`, label: "Cover" });
    }

    insideImageUrls.forEach((src, index) => {
      items.push({
        src,
        alt: `${title} inside page ${index + 1}`,
        label: `Page ${index + 1}`,
      });
    });

    return items;
  }, [coverImageUrl, insideImageUrls, title]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const activeSlide = slides[activeIndex] ?? slides[0];

  const goTo = useCallback(
    (index: number) => {
      if (!slides.length) return;
      setActiveIndex(((index % slides.length) + slides.length) % slides.length);
    },
    [slides.length],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!lightboxOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setLightboxOpen(false);
      if (event.key === "ArrowLeft") goTo(activeIndex - 1);
      if (event.key === "ArrowRight") goTo(activeIndex + 1);
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [lightboxOpen, activeIndex, goTo]);

  if (!slides.length || !activeSlide) {
    return null;
  }

  const lightbox =
    lightboxOpen && mounted
      ? createPortal(
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
              role="dialog"
              aria-modal="true"
              aria-label={`${activeSlide.label} enlarged preview`}
            >
              <button
                type="button"
                aria-label="Close preview"
                className="absolute inset-0 bg-brand-charcoal/85"
                onClick={() => setLightboxOpen(false)}
              />

              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="relative z-10 w-full max-w-4xl"
              >
                <button
                  type="button"
                  aria-label="Close preview"
                  onClick={() => setLightboxOpen(false)}
                  className="absolute -top-2 right-0 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl font-bold text-brand-charcoal shadow-md transition hover:bg-cream sm:-right-2"
                >
                  ×
                </button>

                {slides.length > 1 ? (
                  <>
                    <button
                      type="button"
                      aria-label="Previous preview"
                      onClick={() => goTo(activeIndex - 1)}
                      className="absolute left-0 top-1/2 z-20 -translate-x-2 -translate-y-1/2 rounded-full bg-white/95 px-3 py-2 text-lg font-bold text-brand-charcoal shadow-md transition hover:bg-white sm:-translate-x-4"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      aria-label="Next preview"
                      onClick={() => goTo(activeIndex + 1)}
                      className="absolute right-0 top-1/2 z-20 translate-x-2 -translate-y-1/2 rounded-full bg-white/95 px-3 py-2 text-lg font-bold text-brand-charcoal shadow-md transition hover:bg-white sm:translate-x-4"
                    >
                      ›
                    </button>
                  </>
                ) : null}

                <div className="overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
                  <Image
                    src={activeSlide.src}
                    alt={activeSlide.alt}
                    width={1200}
                    height={1600}
                    className="max-h-[min(85vh,900px)] w-full object-contain"
                    priority
                  />
                </div>

                <p className="mt-3 text-center text-sm font-semibold text-white">
                  {activeSlide.label}
                </p>
              </motion.div>
            </motion.div>
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <>
      <div className={`w-full ${maxWidth} ${className}`}>
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="group block w-full overflow-hidden rounded-2xl border border-brand-brown/20 bg-white shadow-sm transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue-deep"
        >
          <div className="relative aspect-[2/3] w-full">
            <Image
              src={activeSlide.src}
              alt={activeSlide.alt}
              width={440}
              height={660}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
            />
          </div>
          <p className="border-t border-brand-brown/10 bg-cream-deep px-3 py-2 text-xs font-semibold text-brand-charcoal/70">
            {activeSlide.label} · Tap to enlarge
          </p>
        </button>

        {slides.length > 1 ? (
          <div className="mt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-charcoal/55">
              Preview pages
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {slides.map((slide, index) => (
                <button
                  key={slide.src}
                  type="button"
                  aria-label={`Show ${slide.label}`}
                  aria-current={index === activeIndex ? "true" : undefined}
                  onClick={() => setActiveIndex(index)}
                  className={`shrink-0 overflow-hidden rounded-lg border-2 bg-white transition ${
                    index === activeIndex
                      ? "border-brand-blue-deep shadow-sm"
                      : "border-brand-brown/15 opacity-80 hover:border-brand-blue/40 hover:opacity-100"
                  }`}
                >
                  <Image
                    src={slide.src}
                    alt={slide.alt}
                    width={72}
                    height={108}
                    className="h-[54px] w-9 object-cover sm:h-[72px] sm:w-12"
                  />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {lightbox}
    </>
  );
}
