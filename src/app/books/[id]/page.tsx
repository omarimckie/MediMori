import { BookDetailContent } from "@/components/BookDetailContent";
import { PageSection } from "@/components/PageSection";
import { TfButton } from "@/components/ui/TfButton";
import {
  bookDeliveryFormat,
  formatEbookPrice,
  getBookById,
  getBooks,
} from "@/lib/books";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export function generateStaticParams() {
  return getBooks().map((book) => ({ id: book.id }));
}

function bookMetaDescription(book: NonNullable<ReturnType<typeof getBookById>>): string {
  const fromTagline = book.tagline?.trim();
  if (fromTagline) return fromTagline;
  return book.description.trim();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const book = getBookById(id);

  if (!book) {
    return { title: "Book — Twilight.Feather" };
  }

  return {
    title: `${book.title} — Twilight.Feather`,
    description: bookMetaDescription(book),
  };
}

export default async function BookDetailPage({ params }: Props) {
  const { id } = await params;
  const book = getBookById(id);

  if (!book) notFound();

  const insideImages = book.insideImageUrls ?? [];
  const galleryImages = book.amazonGalleryImageUrls ?? [];
  const ebookPrice = formatEbookPrice(book.priceEbook);
  const deliveryFormat = bookDeliveryFormat(book.id);

  return (
    <main>
      <PageSection tone="navy" className="!py-12 sm:!py-14 lg:!py-24">
        <Link
          href="/books"
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
        {ebookPrice ? (
          <p className="mt-5 text-2xl font-extrabold text-white">{ebookPrice}</p>
        ) : null}
        {deliveryFormat ? (
          <p className="mt-1 text-sm font-semibold text-white/85">
            {deliveryFormat}
          </p>
        ) : null}
        <TfButton href="#purchase" className="mt-4 w-full sm:w-auto">
          Buy eBook now
        </TfButton>
      </PageSection>

      <PageSection tone="white" cloudTop="navy" className="!pb-9 sm:!pb-10">
        <BookDetailContent book={book} />
        <div className="mt-7 grid w-full px-1 sm:mt-8 sm:px-0 md:grid-cols-[0.8fr_1.2fr]">
          <div className="flex justify-center md:col-start-2">
            <Link
              href="/books"
              className="inline-flex h-[50px] min-h-[50px] w-full items-center justify-center whitespace-nowrap rounded-xl border border-section-navy bg-cream text-base font-bold text-section-navy transition-colors duration-200 hover:bg-white md:w-[280px]"
            >
              ← Browse All Books
            </Link>
          </div>
        </div>
      </PageSection>

      {galleryImages.length ? (
        <PageSection tone="cream">
          <h2 className="text-2xl font-extrabold text-brand-charcoal">
            Photos from Amazon listing
          </h2>
          <p className="mt-2 text-sm text-brand-charcoal/75">
            Pulled when you run <code className="rounded bg-cream-deep px-1">npm run scrape:amazon</code>.
            Replace with your own assets anytime in{" "}
            <code className="rounded bg-cream-deep px-1">amazonGalleryImageUrls</code>.
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
            differ; edit <code className="rounded bg-cream-deep px-1">amazonAplusText</code>{" "}
            in <code className="rounded bg-cream-deep px-1">books.json</code> as needed.
          </p>
          <div className="mt-6 max-h-[min(70vh,900px)] overflow-y-auto rounded-3xl border border-brand-brown/15 bg-white p-6 text-sm leading-relaxed text-brand-charcoal/90 shadow-sm whitespace-pre-wrap">
            {book.amazonAplusText}
          </div>
        </PageSection>
      ) : null}

      {insideImages.length === 0 ? (
        <PageSection tone={galleryImages.length || book.amazonAplusText ? "cream" : "white"}>
          <h2 className="text-2xl font-extrabold text-brand-charcoal">
            Inside the book preview
          </h2>
          <p className="mt-2 text-sm text-brand-charcoal/75">
            Add or replace preview images in <code className="rounded bg-cream-deep px-1">src/data/books.json</code> under <code className="rounded bg-cream-deep px-1">insideImageUrls</code>.
          </p>
          <p className="mt-4 rounded-2xl border border-dashed border-brand-brown/25 bg-white p-4 text-sm text-brand-charcoal/70">
            No inside preview images yet. Add image URLs or local paths to this
            book&apos;s <code className="rounded bg-cream-deep px-1">insideImageUrls</code>.
          </p>
        </PageSection>
      ) : null}
    </main>
  );
}
