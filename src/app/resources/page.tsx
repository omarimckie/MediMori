import { ResourceCard } from "@/components/ResourceCard";
import { PageSection } from "@/components/PageSection";
import { getRecommendedResources } from "@/lib/resources";

export const metadata = {
  title: "Resources — Twilight.Feather",
  description:
    "Curated articles and reading roundups we recommend for families, caregivers, and educators.",
};

export default function ResourcesPage() {
  const resources = getRecommendedResources();

  return (
    <main>
      <PageSection tone="navy" containerClassName="mx-auto max-w-3xl text-center">
        <p className="text-sm font-extrabold uppercase tracking-wide text-brand-yellow-bright">
          Resources
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Helpful reads we recommend
        </h1>
        <p className="mt-4 text-white/80">
          Articles and reading roundups we have curated for families, caregivers,
          and educators. These link to trusted outside sources, with our notes on
          why each one is worth your time.
        </p>
      </PageSection>

      <PageSection tone="white" cloudTop="navy">
        <div className="grid gap-7 md:grid-cols-2 lg:grid-cols-3">
          {resources.map((resource) => (
            <ResourceCard key={resource.id} resource={resource} />
          ))}
        </div>
      </PageSection>
    </main>
  );
}
