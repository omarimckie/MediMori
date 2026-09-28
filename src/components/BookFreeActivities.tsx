import type { PublishedFreeResource } from "@/lib/marketing/free-resources";
import Link from "next/link";

type Props = {
  resources: PublishedFreeResource[];
};

export function BookFreeActivities({ resources }: Props) {
  if (resources.length === 0) return null;

  return (
    <section className="mt-8 rounded-3xl border border-brand-brown/15 bg-cream-deep/40 p-6">
      <h2 className="text-lg font-extrabold text-brand-charcoal">Free Activities for This Book</h2>
      <p className="mt-2 text-sm text-brand-charcoal/75">
        Downloadable activities connected to this story — free for families and classrooms.
      </p>
      <ul className="mt-4 space-y-2">
        {resources.map((resource) => (
          <li key={resource.id}>
            <Link
              href={resource.publicPath}
              className="text-sm font-bold text-brand-blue-deep underline-offset-4 hover:underline"
            >
              {resource.title}
            </Link>
            <span className="ml-2 text-xs text-brand-charcoal/55">{resource.resourceTypeLabel}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
