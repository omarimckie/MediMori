import { BooksCollection } from "@/components/BooksCollection";
import { PageSection } from "@/components/PageSection";
import { getBooks } from "@/lib/books";
import type { Metadata } from "next";

const BOOKS_DESCRIPTION =
  "Browse children’s health storybooks about sickle cell and asthma, plus a health & medicine word search PDF. Shop Twilight Feather eBooks from $7.";

export const metadata: Metadata = {
  title: "Children’s Health Books",
  description: BOOKS_DESCRIPTION,
  alternates: { canonical: "/books" },
  openGraph: {
    title: "Children’s Health Books — Twilight Feather",
    description: BOOKS_DESCRIPTION,
    url: "/books",
  },
  twitter: {
    title: "Children’s Health Books — Twilight Feather",
    description: BOOKS_DESCRIPTION,
  },
};

export default function BooksPage() {
  const books = getBooks();

  return (
    <main>
      <PageSection
        tone="navy"
        className="!py-12 sm:!py-14 lg:!py-24"
        containerClassName="mx-auto max-w-3xl text-center"
      >
        <p className="text-sm font-extrabold uppercase tracking-wide text-brand-yellow-bright">
          Twilight Feather
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
          Children&apos;s Books That Make Health Easier to Understand
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-white/85">
          Explore engaging stories and activities designed to help children and
          families learn about health conditions in an approachable,
          age-appropriate way.
        </p>
      </PageSection>

      <PageSection tone="white" cloudTop="navy">
        <BooksCollection books={books} />
      </PageSection>
    </main>
  );
}
