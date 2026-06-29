import { BlogPostCard } from "@/components/BlogPostCard";
import { PageSection } from "@/components/PageSection";
import { getPosts } from "@/lib/blog";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BlogPage() {
  const posts = await getPosts();

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
          Write on the blog first, then share each post on social media. You and
          Dale-Marie can publish directly from{" "}
          <Link href="/admin" className="font-bold text-brand-yellow-bright underline-offset-4 hover:underline">
            /admin
          </Link>
          .
        </p>
      </PageSection>

      <PageSection tone="white">
        <div className="grid gap-7 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <BlogPostCard key={post.slug} post={post} />
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
