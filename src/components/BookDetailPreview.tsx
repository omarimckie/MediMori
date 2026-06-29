import { BookCoverImage } from "@/components/BookCoverImage";
import { BookPreviewCarousel } from "@/components/BookPreviewCarousel";
import type { Book } from "@/lib/books";

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
        coverWidth={book.coverWidth}
        coverHeight={book.coverHeight}
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
    <BookCoverImage
      src={book.coverImageUrl}
      alt={`${book.title} cover`}
      width={book.coverWidth ?? 700}
      height={book.coverHeight ?? 1000}
      maxWidthClass="max-w-[340px]"
      className="mx-auto"
      priority
    />
  );
}
