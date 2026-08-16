import { StorybookReader } from "@/components/StorybookReader";
import { getBookById } from "@/lib/books";
import { getLibrarySessionEmail } from "@/lib/library-session";
import { hasEntitlement } from "@/lib/purchases";
import { getReaderBookConfig, isReaderBookId } from "@/lib/reader-catalog";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Read | Twilight Feather",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ bookId: string }>;
};

export default async function ReadBookPage({ params }: Props) {
  const { bookId } = await params;
  const email = await getLibrarySessionEmail();
  if (!email) {
    redirect("/library");
  }

  if (!isReaderBookId(bookId)) {
    redirect("/library");
  }

  const owned = await hasEntitlement(email, bookId);
  if (!owned) {
    redirect("/library");
  }

  const config = getReaderBookConfig(bookId);
  const book = getBookById(bookId);
  if (!config || !book) {
    redirect("/library");
  }

  return (
    <div className="bg-cream-deep">
      <StorybookReader
        bookId={bookId}
        title={book.title}
        totalPages={config.totalPages}
        availablePages={config.availablePages}
        sample={config.sample}
      />
    </div>
  );
}
