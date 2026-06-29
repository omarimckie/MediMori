import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-brand-brown/15 bg-cream">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-10 text-sm text-brand-charcoal/80 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="font-medium">
          © {new Date().getFullYear()} Twilight.Feather. All rights reserved.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href="/#books" className="underline-offset-4 hover:underline">
            Shop books
          </Link>
        </div>
      </div>
    </footer>
  );
}
