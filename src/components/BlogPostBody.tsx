import type { BlogPost } from "@/lib/blog";
import Image from "next/image";
import Link from "next/link";

type Props = {
  post: BlogPost;
};

function Paragraphs({ paragraphs }: { paragraphs: string[] }) {
  return (
    <div className="space-y-4 text-base leading-relaxed text-brand-charcoal/90">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

export function BlogPostBody({ post }: Props) {
  if (post.type === "article") {
    return (
      <div>
        {post.imageUrl ? (
          <div className="mb-8 overflow-hidden rounded-3xl border border-brand-brown/15 bg-white shadow-sm">
            <Image
              src={post.imageUrl}
              alt=""
              width={900}
              height={600}
              className="h-auto w-full object-contain"
            />
          </div>
        ) : null}
        <Paragraphs paragraphs={post.body ?? []} />
      </div>
    );
  }

  if (post.type === "link") {
    return (
      <div className="space-y-6">
        {post.commentary?.length ? <Paragraphs paragraphs={post.commentary} /> : null}

        {post.externalUrl ? (
          <div className="rounded-2xl border border-brand-blue/20 bg-brand-blue/[0.06] p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-brand-blue-deep">
              Original article
            </p>
            <p className="mt-2 text-lg font-extrabold text-brand-charcoal">
              {post.title}
            </p>
            {post.sourceName ? (
              <p className="mt-1 text-sm text-brand-charcoal/70">
                Published by {post.sourceName} — not written by Twilight.Feather.
              </p>
            ) : null}
            <a
              href={post.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-brand-yellow-bright px-5 text-sm font-bold text-section-navy transition hover:brightness-95"
            >
              Read the original article →
            </a>
            <p className="mt-3 break-all text-xs text-brand-charcoal/55">
              {post.externalUrl}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {post.intro?.length ? <Paragraphs paragraphs={post.intro} /> : null}

      <ul className="space-y-4">
        {(post.links ?? []).map((link) => (
          <li
            key={link.url}
            className="rounded-2xl border border-brand-brown/15 bg-white p-5 shadow-sm"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
              {link.source ?? "Recommended read"}
            </p>
            <h3 className="mt-2 text-lg font-extrabold text-brand-charcoal">
              <Link
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-4 hover:text-brand-blue-deep hover:underline"
              >
                {link.title}
              </Link>
            </h3>
            {link.blurb ? (
              <p className="mt-2 text-sm leading-relaxed text-brand-charcoal/80">
                {link.blurb}
              </p>
            ) : null}
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm font-bold text-brand-blue-deep underline-offset-4 hover:underline"
            >
              Open article →
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
