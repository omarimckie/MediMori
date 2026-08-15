import { LibraryAccessForm } from "@/components/LibraryAccessForm";
import { LibrarySignOutButton } from "@/components/LibrarySignOutButton";
import { PageSection } from "@/components/PageSection";
import { getBooks } from "@/lib/books";
import { getLibrarySessionEmail } from "@/lib/library-session";
import { listEntitlementsForEmail } from "@/lib/purchases";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "My Books | Twilight Feather",
  description: "Open the Twilight Feather eBooks you purchased.",
};

type Props = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LibraryPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const email = await getLibrarySessionEmail();

  if (!email) {
    return (
      <PageSection tone="cream">
        <div className="mx-auto max-w-lg px-4 py-16 text-center sm:py-20">
          <h1 className="text-3xl font-extrabold text-brand-charcoal">
            My Books
          </h1>
          <p className="mt-3 text-brand-charcoal/80">
            Enter the email you used at checkout. We will send a one-time link
            that expires in 45 minutes.
          </p>
          {error === "invalid" ? (
            <p
              className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
              role="alert"
            >
              That access link is invalid, expired, or already used. Request a
              new one below.
            </p>
          ) : null}
          <LibraryAccessForm />
        </div>
      </PageSection>
    );
  }

  const entitlements = await listEntitlementsForEmail(email);
  const catalog = getBooks();

  return (
    <PageSection tone="cream">
      <div className="mx-auto max-w-2xl px-4 py-16 sm:py-20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-extrabold text-brand-charcoal">
              My Twilight Feather Books
            </h1>
            <p className="mt-2 text-sm text-brand-charcoal/70">{email}</p>
          </div>
          <LibrarySignOutButton />
        </div>

        {entitlements.length === 0 ? (
          <p className="mt-10 text-brand-charcoal/80">
            We do not have any purchased books for this email yet. If you just
            paid, wait a moment and refresh, or{" "}
            <Link href="/books" className="font-semibold text-brand-green-deep underline">
              visit the shop
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-10 space-y-4">
            {entitlements.map((row) => {
              const book = catalog.find((item) => item.id === row.bookId);
              const title = book?.title ?? row.bookId;
              const isWordSearch = row.bookId === "book-two";

              return (
                <li
                  key={row.bookId}
                  className="rounded-3xl border border-brand-brown/15 bg-white px-5 py-5"
                >
                  <h2 className="text-xl font-extrabold text-brand-blue-deep">
                    {title}
                  </h2>
                  <p className="mt-2 text-sm text-brand-charcoal/75">
                    {isWordSearch
                      ? "You own this PDF. Use the download button on your purchase confirmation page for now. A library download button comes next."
                      : "You own this storybook. The protected online reader comes in a later phase."}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageSection>
  );
}
