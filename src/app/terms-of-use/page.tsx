import { PageSection } from "@/components/PageSection";

export const metadata = {
  title: "Terms of Use — Twilight.Feather",
  description: "The terms that apply when you use the Twilight.Feather website.",
};

export default function TermsOfUsePage() {
  return (
    <main>
      <PageSection tone="navy" containerClassName="mx-auto max-w-3xl text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Terms of Use
        </h1>
        <p className="mt-4 text-white/80">
          A few simple ground rules for using our website and books.
        </p>
      </PageSection>

      <PageSection tone="white" cloudTop="navy" containerClassName="mx-auto max-w-3xl space-y-8">
        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            Our content
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            The stories, artwork, and materials on this site belong to
            Twilight.Feather. You are welcome to enjoy and share links to them,
            but please do not copy, resell, or redistribute them without our
            permission.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            Digital purchases
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            Ebook purchases are for your personal and family use. Download
            links are provided for the buyer and should not be shared publicly.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            Not medical advice
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            Our books and articles are created to help families learn and talk
            about health topics together. They are not a substitute for advice
            from your doctor or care team.
          </p>
        </div>
        <div>
          <h2 className="text-xl font-extrabold text-brand-charcoal">
            Changes
          </h2>
          <p className="mt-2 leading-relaxed text-brand-charcoal/80">
            We may update these terms from time to time. Continued use of the
            site means you accept the current version.
          </p>
        </div>
      </PageSection>
    </main>
  );
}
