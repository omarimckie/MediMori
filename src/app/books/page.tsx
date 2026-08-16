import { BooksCollection } from "@/components/BooksCollection";
import { PageSection } from "@/components/PageSection";
import { getBooks } from "@/lib/books";

export const metadata = {
  title: "Books — Twilight.Feather",
  description:
    "Browse Twilight.Feather children’s books, including Children Diseases: Sickle Cell, Children Diseases: Asthma, and the Health & Medicine Word Search Collection.",
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
