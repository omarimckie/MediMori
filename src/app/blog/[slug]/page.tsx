import { BlogPostAuthor } from "@/components/BlogPostAuthor";
import { BlogPostBody } from "@/components/BlogPostBody";
import { BlogShareActions } from "@/components/BlogShareActions";
import { PageSection } from "@/components/PageSection";
import {
  formatPostDate,
  getPostAuthor,
  getPostBySlug,
  getPostTypeLabel,
  getPosts,
  isSharedBlogPost,
} from "@/lib/blog";
import { absoluteUrl } from "@/lib/site";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) {
    return { title: "Post not found" };
  }

  const pageUrl = absoluteUrl(`/blog/${post.slug}`);
  const imageUrl = post.imageUrl ? absoluteUrl(post.imageUrl) : undefined;

  return {
    title: `${post.title} — Twilight.Feather Blog`,
    description: post.excerpt,
    openGraph: {
      type: "article",
      title: post.title,
      description: post.excerpt,
      url: pageUrl,
      publishedTime: post.publishedAt,
      siteName: "Twilight.Feather",
      ...(imageUrl
        ? {
            images: [{ url: imageUrl, alt: post.title }],
          }
        : {}),
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title: post.title,
      description: post.excerpt,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) notFound();

  const pageUrl = absoluteUrl(`/blog/${post.slug}`);
  const typeLabel = getPostTypeLabel(post.type);
  const author = getPostAuthor(post);
  const shared = isSharedBlogPost(post.type);

  return (
    <main>
      <PageSection tone="navy" className="py-12 sm:py-14" containerClassName="mx-auto max-w-3xl">
        <Link
          href="/blog"
          className="inline-flex items-center rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/20"
        >
          ← Back to blog
        </Link>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-yellow-bright">
            {post.category}
          </p>
          <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/80">
            {typeLabel}
          </span>
        </div>

        <h1 className="mt-3 text-3xl font-extrabold text-white sm:text-4xl">
          {post.title}
        </h1>
        <p className="mt-3 text-sm font-semibold text-white/75">
          {formatPostDate(post)}
        </p>
        {author ? (
          <div className="mt-4">
            <BlogPostAuthor author={author} tone="dark" shared={shared} />
          </div>
        ) : null}
        <p className="mt-4 text-base leading-relaxed text-white/85">{post.excerpt}</p>
      </PageSection>

      <PageSection tone="white" containerClassName="mx-auto max-w-3xl">
        <article className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm sm:p-8">
          <BlogPostBody post={post} />
        </article>

        <div className="mt-8">
          <BlogShareActions url={pageUrl} title={post.title} />
        </div>

        {author ? (
          <div className="mt-8">
            <BlogPostAuthor author={author} variant="detail" shared={shared} />
          </div>
        ) : null}

        {post.imageUrl && post.type !== "article" ? (
          <div className="mt-8 overflow-hidden rounded-3xl border border-brand-brown/15">
            <Image
              src={post.imageUrl}
              alt=""
              width={900}
              height={600}
              className="h-auto w-full object-contain"
            />
          </div>
        ) : null}
      </PageSection>
    </main>
  );
}
