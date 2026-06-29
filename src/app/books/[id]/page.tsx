import { EbookCheckoutForm } from "@/components/EbookCheckoutForm";
import { PageSection } from "@/components/PageSection";
import { getBookById, getBooks } from "@/lib/books";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export function generateStaticParams() {
  return getBooks().map((book) => ({ id: book.id }));
}

export default async function BookDetailPage({ params }: Props) {
  const { id } = await params;
  const book = getBookById(id);

  if (!book) notFound();

  const insideImages = book.insideImageUrls ?? [];
  const galleryImages = book.amazonGalleryImageUrls ?? [];
  const isSickleCellBook = book.id === "book-one";
  const hasDirectEbookCheckout = Boolean(book.stripePriceIdEbook?.trim());

  return (
    <main>
      <PageSection tone="navy" className="py-12 sm:py-14">
        <Link
          href="/#books"
          className="inline-flex items-center rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/20"
        >
          Back to books
        </Link>
        <h1 className="mt-6 text-3xl font-extrabold text-white sm:text-4xl">
          {book.title}
        </h1>
        {book.subtitle ? (
          <p className="mt-2 text-base font-semibold text-brand-yellow-bright">
            {book.subtitle}
          </p>
        ) : null}
      </PageSection>

      <PageSection tone="white">
        <div className="grid gap-8 md:grid-cols-[0.8fr_1.2fr]">
          <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-3xl border border-brand-brown/20 bg-white shadow-sm">
            {book.coverImageUrl ? (
              <Image
                src={book.coverImageUrl}
                alt={`${book.title} cover`}
                width={700}
                height={1000}
                className="h-auto w-full object-cover"
                priority
              />
            ) : (
              <div className="flex h-[420px] items-center justify-center bg-cream-section text-sm font-semibold text-brand-charcoal/70">
                Cover image coming soon
              </div>
            )}
          </div>

          <article className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm">
            {book.amazonStarRating ? (
              <p className="inline-flex items-center gap-2 rounded-full bg-brand-yellow/25 px-4 py-2 text-sm font-bold text-brand-charcoal">
                <span aria-hidden="true" className="text-brand-orange-deep">
                  ★
                </span>
                {book.amazonStarRating}
              </p>
            ) : null}

            <p className="mt-5 leading-relaxed text-brand-charcoal/85">
              {book.description}
            </p>

            <div className="mt-7 grid gap-3 rounded-2xl border border-brand-brown/15 bg-cream-section p-4 text-sm">
              <p className="font-bold text-brand-charcoal">Pricing</p>
              <p className="text-brand-charcoal/85">
                Paperback: <span className="font-semibold">{book.pricePaperback ?? "Set price"}</span>
              </p>
              <p className="text-brand-charcoal/85">
                eBook (direct): <span className="font-semibold">{book.priceEbook ?? "Set price"}</span>
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {book.amazonPaperbackUrl ? (
                <a
                  href={book.amazonPaperbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-yellow-bright px-5 text-sm font-bold text-section-navy transition hover:brightness-95"
                >
                  Paperback on Amazon
                </a>
              ) : null}
            </div>

            {isSickleCellBook ? (
              <EbookCheckoutForm
                bookId={book.id}
                ebookFileBaseName={book.ebookFileBaseName}
                isEnabled={hasDirectEbookCheckout}
              />
            ) : null}
          </article>
        </div>
      </PageSection>

      {galleryImages.length ? (
        <PageSection tone="cream">
          <h2 className="text-2xl font-extrabold text-brand-charcoal">
            Photos from Amazon listing
          </h2>
          <p className="mt-2 text-sm text-brand-charcoal/75">
            Pulled when you run <code className="rounded bg-white px-1">npm run scrape:amazon</code>.
            Replace with your own assets anytime in{" "}
            <code className="rounded bg-white px-1">amazonGalleryImageUrls</code>.
          </p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {galleryImages.map((src, index) => (
              <div
                key={`${book.id}-gallery-${index}`}
                className="overflow-hidden rounded-2xl border border-brand-brown/15 bg-white shadow-sm"
              >
                <Image
                  src={src}
                  alt={`${book.title} listing photo ${index + 1}`}
                  width={900}
                  height={900}
                  className="h-auto w-full object-contain"
                />
              </div>
            ))}
          </div>
        </PageSection>
      ) : null}

      {book.amazonAplusText ? (
        <PageSection tone="white">
          <h2 className="text-2xl font-extrabold text-brand-charcoal">
            More from the Amazon page (A+ style content)
          </h2>
          <p className="mt-2 text-sm text-brand-charcoal/75">
            Plain-text extract for readability. Layout and images on Amazon may
            differ; edit <code className="rounded bg-cream-section px-1">amazonAplusText</code>{" "}
            in <code className="rounded bg-cream-section px-1">books.json</code> as needed.
          </p>
          <div className="mt-6 max-h-[min(70vh,900px)] overflow-y-auto rounded-3xl border border-brand-brown/15 bg-white p-6 text-sm leading-relaxed text-brand-charcoal/90 shadow-sm whitespace-pre-wrap">
            {book.amazonAplusText}
          </div>
        </PageSection>
      ) : null}

      <PageSection tone={galleryImages.length || book.amazonAplusText ? "cream" : "white"}>
        <h2 className="text-2xl font-extrabold text-brand-charcoal">
          Inside the book preview
        </h2>
        <p className="mt-2 text-sm text-brand-charcoal/75">
          Add or replace preview images in <code className="rounded bg-white px-1">src/data/books.json</code> under <code className="rounded bg-white px-1">insideImageUrls</code>.
        </p>

        {insideImages.length ? (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {insideImages.map((src, index) => (
              <div
                key={`${book.id}-inside-${index}`}
                className="overflow-hidden rounded-2xl border border-brand-brown/15 bg-white shadow-sm"
              >
                <Image
                  src={src}
                  alt={`${book.title} inside page ${index + 1}`}
                  width={900}
                  height={900}
                  className="h-auto w-full bg-cream-section object-contain"
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-brand-brown/25 bg-white p-4 text-sm text-brand-charcoal/70">
            No inside preview images yet. Add image URLs or local paths to this
            book&apos;s <code className="rounded bg-cream-section px-1">insideImageUrls</code>.
          </p>
        )}
      </PageSection>
    </main>
  );
}
