import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageSection } from "@/components/PageSection";
import { getBookById } from "@/lib/books";
import { getPublishedFreeResourceBySlug } from "@/lib/marketing/free-resources";
import { getMarketingStore } from "@/lib/marketing/context";
import { freeResourcePublicPreviewMedia } from "@/lib/marketing/resource-preview";
import { absoluteUrl } from "@/lib/site";
import type { Metadata } from "next";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const row = await getPublishedFreeResourceBySlug(getMarketingStore(), slug);
  if (!row) {
    return { title: "Resource not found", robots: { index: false, follow: false } };
  }
  const { resource, hasDeliverablePreview } = row;
  const canonical = absoluteUrl(resource.publicPath);
  const previewMedia = freeResourcePublicPreviewMedia(resource.id, hasDeliverablePreview);
  return {
    title: resource.seoTitle,
    description: resource.seoDescription,
    alternates: { canonical },
    openGraph: {
      title: resource.seoTitle,
      description: resource.seoDescription,
      url: canonical,
      type: "article",
      images: previewMedia ? [{ url: previewMedia.openGraphImageUrl }] : undefined,
    },
    robots: { index: true, follow: true },
  };
}

export default async function FreeResourcePage({ params }: Props) {
  const { slug } = await params;
  const row = await getPublishedFreeResourceBySlug(getMarketingStore(), slug);
  if (!row) notFound();

  const { resource, content, hasDeliverablePreview } = row;
  const book = resource.bookId ? getBookById(resource.bookId) : undefined;
  const downloadHref = `/api/resources/free/${content.id}/download`;
  const previewMedia = freeResourcePublicPreviewMedia(resource.id, hasDeliverablePreview);

  return (
    <main>
      <PageSection tone="navy" containerClassName="mx-auto max-w-3xl">
        <p className="text-sm font-extrabold uppercase tracking-wide text-brand-yellow-bright">
          Free resource · {resource.resourceTypeLabel}
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          {resource.title}
        </h1>
        {resource.relatedCondition ? (
          <p className="mt-3 text-white/80">Topic: {resource.relatedCondition}</p>
        ) : null}
      </PageSection>

      <PageSection tone="white" cloudTop="navy">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-2">
          {previewMedia ? (
            <div className="relative aspect-[4/5] overflow-hidden rounded-3xl border border-brand-brown/15 bg-cream-deep">
              <Image
                src={previewMedia.imageSrc}
                alt={resource.title}
                fill
                className="object-contain"
                sizes="(max-width: 1024px) 100vw, 50vw"
                unoptimized
              />
            </div>
          ) : null}
          <div>
            <p className="text-sm leading-relaxed text-brand-charcoal/85">{resource.description}</p>
            {book ? (
              <p className="mt-4 text-sm text-brand-charcoal/70">
                Related book:{" "}
                <Link href={`/books/${book.id}`} className="font-bold text-brand-blue-deep underline-offset-4 hover:underline">
                  {book.title}
                </Link>
              </p>
            ) : null}
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={downloadHref}
                className="inline-flex h-12 items-center rounded-xl bg-brand-green-deep px-6 text-sm font-bold text-white"
              >
                Download
              </a>
              {book ? (
                <Link
                  href={`/books/${book.id}`}
                  className="inline-flex h-12 items-center rounded-xl border border-brand-brown/20 bg-white px-6 text-sm font-bold text-brand-charcoal"
                >
                  {resource.cta ?? "Explore the book"}
                </Link>
              ) : (
                <Link
                  href="/books"
                  className="inline-flex h-12 items-center rounded-xl border border-brand-brown/20 bg-white px-6 text-sm font-bold text-brand-charcoal"
                >
                  Browse books
                </Link>
              )}
            </div>
            <p className="mt-6 text-xs text-brand-charcoal/55">
              <Link href="/resources" className="underline-offset-4 hover:underline">
                Back to resources
              </Link>
            </p>
          </div>
        </div>
      </PageSection>
    </main>
  );
}
