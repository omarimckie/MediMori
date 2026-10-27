import { BlogPostAuthor } from "@/components/BlogPostAuthor";
import { formatPostDate, getPostAuthor, getPostTypeLabel, isSharedBlogPost, type BlogPost } from "@/lib/blog";
import Link from "next/link";

type Props = {
  post: BlogPost;
};

export function BlogPostCard({ post }: Props) {
  const typeLabel = getPostTypeLabel(post.type);
  const author = getPostAuthor(post);
  const shared = isSharedBlogPost(post.type);

  return (
    <article className="flex h-full flex-col rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm shadow-brand-brown/10 transition hover:border-brand-blue/25 hover:shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
          {post.category}
        </p>
        <span className="rounded-full bg-cream-deep px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-charcoal/55">
          {typeLabel}
        </span>
      </div>

      <h2 className="mt-2 text-xl font-extrabold text-brand-charcoal">
        <Link
          href={`/blog/${post.slug}`}
          className="underline-offset-4 transition hover:text-brand-blue-deep hover:underline"
        >
          {post.title}
        </Link>
      </h2>

      <p className="mt-3 flex-1 text-sm leading-relaxed text-brand-charcoal/80">
        {post.excerpt}
      </p>

      <div className="mt-5 space-y-3">
        {author ? <BlogPostAuthor author={author} shared={shared} /> : null}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-brand-charcoal/60">
            {formatPostDate(post)}
          </p>
          <Link
            href={`/blog/${post.slug}`}
            className="text-xs font-bold text-brand-blue-deep underline-offset-4 hover:underline"
          >
            Read more →
          </Link>
        </div>
      </div>
    </article>
  );
}
