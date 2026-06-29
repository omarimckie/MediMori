import booksData from "@/data/books.json";

export type Book = {
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  /** Amazon book description HTML (paragraphs + bullet lists). */
  descriptionHtml?: string;
  coverImageUrl?: string;
  coverWidth?: number;
  coverHeight?: number;
  /** Extra listing photos scraped from Amazon (when available). */
  amazonGalleryImageUrls?: string[];
  /** e.g. "4.7 out of 5 stars · 128 reviews" */
  amazonStarRating?: string;
  amazonReviewCount?: string;
  /** Plain text from A+ / brand story region (best-effort scrape). */
  amazonAplusText?: string;
  insideImageUrls?: string[];
  pricePaperback?: string;
  priceEbook?: string;
  amazonPaperbackUrl?: string;
  ebookFileBaseName: string;
  stripePriceIdEbook?: string;
};

export function getBooks(): Book[] {
  return booksData.books;
}

export function getBookById(id: string): Book | undefined {
  return getBooks().find((b) => b.id === id);
}
