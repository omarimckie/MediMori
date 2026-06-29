import { PageSection } from "@/components/PageSection";
import Link from "next/link";

const posts = [
  {
    title: "Helping Kids Understand Health Through Stories",
    excerpt:
      "Simple language and gentle storytelling can make medical topics less scary and more approachable for children.",
    date: "April 2026",
    category: "Wellness",
  },
  {
    title: "5 Ways Families Can Build a Reading Routine",
    excerpt:
      "Small daily reading habits create stronger confidence, vocabulary growth, and emotional connection at home.",
    date: "April 2026",
    category: "Parent Tips",
  },
  {
    title: "Inside Twilight.Feather: Why We Create These Books",
    excerpt:
      "A look at our mission to empower little minds with books rooted in compassion, wellness, and curiosity.",
    date: "April 2026",
    category: "Behind the Scenes",
  },
];

export default function BlogPage() {
  return (
    <main>
      <PageSection tone="navy" containerClassName="mx-auto max-w-3xl text-center">
        <p className="text-sm font-extrabold uppercase tracking-wide text-brand-yellow-bright">
          Twilight.Feather Blog
        </p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Stories, tips, and wellness insights
        </h1>
        <p className="mt-4 text-white/80">
          This section is ready for your upcoming posts. Replace these starter
          cards with your real blog content anytime.
        </p>
      </PageSection>

      <PageSection tone="white">
        <div className="grid gap-7 md:grid-cols-3">
          {posts.map((post) => (
            <article
              key={post.title}
              className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm shadow-brand-brown/10"
            >
              <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
                {post.category}
              </p>
              <h2 className="mt-2 text-xl font-extrabold text-brand-charcoal">
                {post.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-brand-charcoal/80">
                {post.excerpt}
              </p>
              <p className="mt-4 text-xs font-semibold text-brand-charcoal/60">
                {post.date}
              </p>
            </article>
          ))}
        </div>
      </PageSection>

      <PageSection tone="cream" containerClassName="mx-auto max-w-3xl text-center">
        <h2 className="text-2xl font-extrabold text-brand-charcoal sm:text-3xl">
          Ready to read together?
        </h2>
        <p className="mt-3 text-brand-charcoal/75">
          Explore our children&apos;s books and find your next family favorite.
        </p>
        <Link
          href="/#books"
          className="mt-6 inline-flex rounded-2xl bg-brand-yellow-bright px-6 py-3 text-sm font-bold text-section-navy transition hover:brightness-95"
        >
          Explore our books
        </Link>
      </PageSection>
    </main>
  );
}
