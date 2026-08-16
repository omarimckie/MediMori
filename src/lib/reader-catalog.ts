export const READER_BOOK_IDS = ["book-one", "book-three"] as const;

export type ReaderBookId = (typeof READER_BOOK_IDS)[number];

export type ReaderBookConfig = {
  totalPages: number;
  /** 1-based PDF page numbers stored as private page images. */
  availablePages: number[];
  sample: boolean;
};

/** Full private page-image sets. Word Search is not a reader book. */
export const READER_BOOKS: Record<ReaderBookId, ReaderBookConfig> = {
  "book-one": {
    totalPages: 26,
    availablePages: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25, 26,
    ],
    sample: false,
  },
  "book-three": {
    totalPages: 27,
    availablePages: [
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
      22, 23, 24, 25, 26, 27,
    ],
    sample: false,
  },
};

export function isReaderBookId(bookId: string): bookId is ReaderBookId {
  return (READER_BOOK_IDS as readonly string[]).includes(bookId);
}

export function getReaderBookConfig(bookId: string): ReaderBookConfig | null {
  if (!isReaderBookId(bookId)) return null;
  return READER_BOOKS[bookId];
}

export function getReaderPagePathname(bookId: ReaderBookId, page: number): string {
  return `reader/${bookId}/page-${String(page).padStart(3, "0")}.webp`;
}
