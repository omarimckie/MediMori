import { BookCoverImage } from "@/components/BookCoverImage";
import { TfButton } from "@/components/ui/TfButton";
import type { Book } from "@/lib/books";

const DISPLAY_ORDER = ["book-one", "book-three", "book-two"] as const;

const coverAlt: Record<string, string> = {
  "book-one": "Children Diseases: Sickle Cell book cover",
  "book-three":
    "Children Diseases: Asthma — AJ Can Breathe Easy book cover",
  "book-two": "Health & Medicine Word Search Collection book cover",
};

function orderedBooks(books: Book[]) {
  return DISPLAY_ORDER.map((id) => books.find((book) => book.id === id)).filter(
    (book): book is Book => Boolean(book),
  );
}

export function BooksCollection({ books }: { books: Book[] }) {
  const catalog = orderedBooks(books);

  return (
    <ul className="mx-auto w-full max-w-[760px] space-y-8 lg:max-w-[920px] lg:space-y-10">
      {catalog.map((book, index) => (
        <li
          key={book.id}
          className="grid items-center gap-6 rounded-3xl border border-brand-brown/15 bg-white p-5 shadow-sm sm:p-8 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)] md:gap-8 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:gap-10 lg:px-10"
        >
          <div className="flex justify-center md:justify-start">
            {book.coverImageUrl ? (
              <BookCoverImage
                src={book.coverImageUrl}
                alt={coverAlt[book.id] ?? `${book.title} book cover`}
                width={book.coverWidth ?? 700}
                height={book.coverHeight ?? 1000}
                maxWidthClass="max-w-[220px] lg:max-w-[280px]"
                className="mx-0"
                priority={index === 0}
              />
            ) : (
              <div className="flex aspect-[2/3] w-full max-w-[220px] items-center justify-center rounded-2xl border-2 border-dashed border-brand-brown/30 bg-brand-charcoal/[0.03] text-sm font-medium text-brand-charcoal/45 lg:max-w-[280px]">
                Cover coming soon
              </div>
            )}
          </div>
          <div className="text-center md:text-left">
            <h2 className="text-2xl font-semibold leading-snug text-brand-navy sm:text-3xl">
              {book.title}
            </h2>
            {book.cardSubtitle ? (
              <p className="mt-1 text-base font-bold text-brand-navy/80">
                {book.cardSubtitle}
              </p>
            ) : null}
            {book.tagline ? (
              <p className="mt-3 text-sm leading-relaxed text-brand-charcoal/75 sm:text-base">
                {book.tagline}
              </p>
            ) : null}
            <TfButton
              href={`/books/${book.id}`}
              className={`w-full sm:w-auto lg:min-w-[10rem] ${
                book.id === "book-one" ? "mt-7 md:mt-5" : "mt-5"
              }`}
            >
              View Book
            </TfButton>
          </div>
        </li>
      ))}
    </ul>
  );
}
