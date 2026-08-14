import type { RecommendedResource } from "@/lib/resources";

type Props = {
  resource: RecommendedResource;
};

export function ResourceCard({ resource }: Props) {
  return (
    <article className="flex h-full flex-col rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm shadow-brand-brown/10 transition hover:border-brand-blue/25 hover:shadow-md">
      <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
        {resource.category}
      </p>

      <h2 className="mt-2 text-xl font-extrabold text-brand-charcoal">
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 transition hover:text-brand-blue-deep hover:underline"
        >
          {resource.title}
        </a>
      </h2>

      <p className="mt-3 flex-1 text-sm leading-relaxed text-brand-charcoal/80">
        {resource.description}
      </p>

      <div className="mt-5 space-y-3">
        <p className="text-xs font-semibold text-brand-charcoal/60">
          {resource.source}
        </p>
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs font-bold text-brand-blue-deep underline-offset-4 hover:underline"
        >
          {resource.cta}
        </a>
      </div>
    </article>
  );
}
