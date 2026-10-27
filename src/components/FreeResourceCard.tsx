import type { PublishedFreeResource } from "@/lib/marketing/free-resources";
import { freeResourcePublicPreviewMedia } from "@/lib/marketing/resource-preview";
import Image from "next/image";
import Link from "next/link";

type Props = {
  resource: PublishedFreeResource;
  hasDeliverablePreview: boolean;
};

function truncateDescription(text: string, maxLength = 160): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function FreeResourceCard({ resource, hasDeliverablePreview }: Props) {
  const previewMedia = freeResourcePublicPreviewMedia(resource.id, hasDeliverablePreview);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-brand-brown/15 bg-white shadow-sm shadow-brand-brown/10 transition hover:border-brand-blue/25 hover:shadow-md">
      {previewMedia ? (
        <div className="relative aspect-[4/3] w-full border-b border-brand-brown/10 bg-cream-deep">
          <Image
            src={previewMedia.imageSrc}
            alt={resource.title}
            fill
            className="object-contain p-2"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
            unoptimized
          />
        </div>
      ) : null}
      <div className="flex flex-1 flex-col p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
          {resource.resourceTypeLabel}
        </p>
        <h2 className="mt-2 text-xl font-extrabold text-brand-charcoal">
          <Link
            href={resource.publicPath}
            className="underline-offset-4 transition hover:text-brand-blue-deep hover:underline"
          >
            {resource.title}
          </Link>
        </h2>
        {resource.relatedCondition ? (
          <p className="mt-2 text-xs font-semibold text-brand-charcoal/60">
            Topic: {resource.relatedCondition}
          </p>
        ) : null}
        <p className="mt-3 flex-1 text-sm leading-relaxed text-brand-charcoal/80">
          {truncateDescription(resource.description)}
        </p>
        <Link
          href={resource.publicPath}
          className="mt-5 inline-block text-sm font-bold text-brand-blue-deep underline-offset-4 hover:underline"
        >
          View resource
        </Link>
      </div>
    </article>
  );
}
