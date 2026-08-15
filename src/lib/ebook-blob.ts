/** Permanent private Blob pathnames. Do not store dashboard signed URLs. */
export const EBOOK_BLOB_PATHNAMES = {
  "book-one": "Sickle Cell.pdf",
  "book-two": "Word Search.pdf",
  "book-three": "Asthma.pdf",
} as const;

export type EbookBookId = keyof typeof EBOOK_BLOB_PATHNAMES;

export const EBOOK_SIGNED_URL_TTL_MS = 10 * 60 * 1000;

export function getEbookBlobPathname(bookId: string): string | undefined {
  if (bookId in EBOOK_BLOB_PATHNAMES) {
    return EBOOK_BLOB_PATHNAMES[bookId as EbookBookId];
  }
  return undefined;
}
