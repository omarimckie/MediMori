import { BlogPostCard } from "@/components/BlogPostCard";
import { PageSection } from "@/components/PageSection";
import { getPosts, isSharedBlogPost } from "@/lib/blog";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Resources — Twilight.Feather",
  description:
    "Curated articles and reading roundups we recommend for families, caregivers, and educators.",
};

export default async function ResourcesPage() {
  const posts = (await getPosts()).filter((post) => isSharedBlogPost(post.type));

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

      <PageSection tone="white">
        {posts.length ? (
          <div className="grid gap-7 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <BlogPostCard key={post.slug} post={post} />
            ))}
          </div>
        ) : (
          <p className="text-center text-brand-charcoal/70">
            No curated resources yet — check back soon.
          </p>
        )}
      </PageSection>

      <PageSection tone="cream" containerClassName="mx-auto max-w-3xl text-center">
        <h2 className="text-2xl font-extrabold text-brand-charcoal sm:text-3xl">
          Looking for our own stories?
        </h2>
        <p className="mt-3 text-brand-charcoal/75">
          Visit the blog for articles written by the Twilight.Feather team.
        </p>
        <Link
          href="/blog"
          className="mt-6 inline-flex rounded-2xl bg-brand-yellow-bright px-6 py-3 text-sm font-bold text-section-navy transition hover:brightness-95"
        >
          Open the blog
        </Link>
      </PageSection>
    </main>
  );
}
