import { FreeResourceCard } from "@/components/FreeResourceCard";
import { PageSection } from "@/components/PageSection";
import { listPublishedFreeResourceCatalog } from "@/lib/marketing/free-resources";
import { getMarketingStore } from "@/lib/marketing/context";
import { SITE_NAME } from "@/lib/seo";
import type { Metadata } from "next";
import Link from "next/link";

const FREE_RESOURCES_DESCRIPTION =
  "Free downloadable activity sheets, coloring pages, and worksheets from Twilight Feather — for families, caregivers, and educators.";

export const metadata: Metadata = {
  title: { absolute: `Free Resources — ${SITE_NAME}` },
  description: FREE_RESOURCES_DESCRIPTION,
  alternates: { canonical: "/resources/free" },
  openGraph: {
    title: `Free Resources — ${SITE_NAME}`,
    description: FREE_RESOURCES_DESCRIPTION,
    url: "/resources/free",
  },
  twitter: {
    title: `Free Resources — ${SITE_NAME}`,
    description: FREE_RESOURCES_DESCRIPTION,
  },
};

export default async function FreeResourcesIndexPage() {
  const items = await listPublishedFreeResourceCatalog(getMarketingStore());

  return (
    <main>
      <PageSection tone="navy" containerClassName="mx-auto max-w-3xl">
        <nav aria-label="Breadcrumb" className="text-sm text-white/70">
          <Link href="/resources" className="underline-offset-4 hover:text-white hover:underline">
            Resources
          </Link>
          <span aria-hidden="true"> → </span>
          <span className="text-white/90">Free Resources</span>
        </nav>
        <p className="mt-4 text-sm font-extrabold uppercase tracking-wide text-brand-yellow-bright">
          Free resources
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Free Resources
        </h1>
        <p className="mt-4 text-white/80">
          Download free activities and printable resources from Twilight Feather — made for
          families and classrooms exploring children&apos;s health topics together.
        </p>
      </PageSection>

      <PageSection tone="white" cloudTop="navy">
        {items.length === 0 ? (
          <div className="mx-auto max-w-xl text-center">
            <p className="text-lg font-extrabold text-brand-charcoal">No free resources yet</p>
            <p className="mt-3 text-sm leading-relaxed text-brand-charcoal/75">
              Check back soon for new activity sheets and downloads, or browse our{" "}
              <Link href="/resources" className="font-bold text-brand-blue-deep underline-offset-4 hover:underline">
                helpful resources
              </Link>{" "}
              and{" "}
              <Link href="/books" className="font-bold text-brand-blue-deep underline-offset-4 hover:underline">
                books
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="grid gap-7 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <FreeResourceCard
                key={item.resource.id}
                resource={item.resource}
                hasDeliverablePreview={item.hasDeliverablePreview}
              />
            ))}
          </div>
        )}
      </PageSection>
    </main>
  );
}
