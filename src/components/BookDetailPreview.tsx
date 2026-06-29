import { BookPreviewCarousel } from "@/components/BookPreviewCarousel";
import type { Book } from "@/lib/books";
import Image from "next/image";

type Props = {
  book: Book;
};

export function BookDetailPreview({ book }: Props) {
  const insideImages = book.insideImageUrls ?? [];

  if (insideImages.length > 0) {
    return (
      <BookPreviewCarousel
        title={book.title}
        coverImageUrl={book.coverImageUrl}
        insideImageUrls={insideImages}
        maxWidth="max-w-[340px]"
        className="mx-auto"
      />
    );
  }

  if (!book.coverImageUrl) {
    return (
      <div className="mx-auto flex h-[420px] w-full max-w-[340px] items-center justify-center rounded-3xl border border-brand-brown/20 bg-cream text-sm font-semibold text-brand-charcoal/70">
        Cover image coming soon
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-3xl border border-brand-brown/20 bg-white shadow-sm">
      <Image
        src={book.coverImageUrl}
        alt={`${book.title} cover`}
        width={700}
        height={1000}
        className="h-auto w-full object-cover"
        priority
      />
    </div>
  );
}
