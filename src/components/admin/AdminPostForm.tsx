"use client";

import type { BlogRoundupLink } from "@/lib/blog";
import type { BlogPostType } from "@/lib/blog-types";
import { slugify } from "@/lib/slugify";
import { FormEvent, useMemo, useState } from "react";

export type AdminPostFormValues = {
  slug: string;
  type: BlogPostType;
  title: string;
  excerpt: string;
  category: string;
  publishedAt: string;
  dateLabel: string;
  authorId: string;
  imageUrl: string;
  bodyText: string;
  externalUrl: string;
  sourceName: string;
  commentaryText: string;
  introText: string;
  links: BlogRoundupLink[];
};

type Props = {
  initialValues?: Partial<AdminPostFormValues>;
  mode: "create" | "edit";
  onSubmit: (values: AdminPostFormValues) => Promise<void>;
};

const defaultLink: BlogRoundupLink = { title: "", url: "", source: "", blurb: "" };

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function splitParagraphs(value: string) {
  return value
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function AdminPostForm({ initialValues, mode, onSubmit }: Props) {
  const [type, setType] = useState<BlogPostType>(initialValues?.type ?? "link");
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [slug, setSlug] = useState(initialValues?.slug ?? "");
  const [excerpt, setExcerpt] = useState(initialValues?.excerpt ?? "");
  const [category, setCategory] = useState(initialValues?.category ?? "What we're reading");
  const [publishedAt, setPublishedAt] = useState(initialValues?.publishedAt ?? todayIsoDate());
  const [dateLabel, setDateLabel] = useState(initialValues?.dateLabel ?? "");
  const [authorId, setAuthorId] = useState(initialValues?.authorId ?? "");
  const [imageUrl, setImageUrl] = useState(initialValues?.imageUrl ?? "");
  const [bodyText, setBodyText] = useState(initialValues?.bodyText ?? "");
  const [externalUrl, setExternalUrl] = useState(initialValues?.externalUrl ?? "");
  const [sourceName, setSourceName] = useState(initialValues?.sourceName ?? "");
  const [commentaryText, setCommentaryText] = useState(initialValues?.commentaryText ?? "");
  const [introText, setIntroText] = useState(initialValues?.introText ?? "");
  const [links, setLinks] = useState<BlogRoundupLink[]>(
    initialValues?.links?.length ? initialValues.links : [{ ...defaultLink }],
  );
  const [slugTouched, setSlugTouched] = useState(Boolean(initialValues?.slug));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewSlug = useMemo(() => {
    if (mode === "edit") return slug;
    return slugTouched ? slugify(slug) : slugify(title);
  }, [mode, slug, slugTouched, title]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await onSubmit({
        slug: previewSlug,
        type,
        title: title.trim(),
        excerpt: excerpt.trim(),
        category: category.trim(),
        publishedAt,
        dateLabel: dateLabel.trim(),
        authorId: authorId.trim(),
        imageUrl: imageUrl.trim(),
        bodyText,
        externalUrl: externalUrl.trim(),
        sourceName: sourceName.trim(),
        commentaryText,
        introText,
        links,
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save post.");
    } finally {
      setLoading(false);
    }
  }

  const fieldClass =
    "mt-1 h-11 w-full rounded-xl border border-brand-brown/20 bg-white px-3 text-sm text-brand-charcoal outline-none ring-brand-green focus:ring-2";
  const textAreaClass =
    "mt-1 min-h-[140px] w-full rounded-xl border border-brand-brown/20 bg-white px-3 py-3 text-sm text-brand-charcoal outline-none ring-brand-green focus:ring-2";
  const labelClass = "text-sm font-bold text-brand-charcoal";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Post type</span>
          <select
            value={type}
            onChange={(event) => setType(event.target.value as BlogPostType)}
            className={fieldClass}
          >
            <option value="link">Link share</option>
            <option value="article">Article</option>
            <option value="roundup">Reading roundup</option>
          </select>
        </label>

        <label className="block">
          <span className={labelClass}>Author</span>
          <select
            value={authorId}
            onChange={(event) => setAuthorId(event.target.value)}
            className={fieldClass}
          >
            <option value="">Omari (default)</option>
            <option value="dale-marie">Dr. Dale-Marie McKie</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>Title</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          className={fieldClass}
        />
      </label>

      <label className="block">
        <span className={labelClass}>URL slug</span>
        <input
          value={mode === "edit" ? slug : slugTouched ? slug : previewSlug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.target.value);
          }}
          readOnly={mode === "edit"}
          required
          className={`${fieldClass} ${mode === "edit" ? "bg-cream-deep" : ""}`}
        />
        <p className="mt-1 text-xs text-brand-charcoal/60">
          Public URL: /blog/{previewSlug || "your-slug"}
        </p>
      </label>

      <label className="block">
        <span className={labelClass}>Short excerpt</span>
        <textarea
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
          required
          className={textAreaClass}
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Category</span>
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            required
            className={fieldClass}
          />
        </label>

        <label className="block">
          <span className={labelClass}>Published date</span>
          <input
            type="date"
            value={publishedAt}
            onChange={(event) => setPublishedAt(event.target.value)}
            required
            className={fieldClass}
          />
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>Display date label (optional)</span>
        <input
          value={dateLabel}
          onChange={(event) => setDateLabel(event.target.value)}
          placeholder="June 2026"
          className={fieldClass}
        />
      </label>

      {type === "article" ? (
        <>
          <label className="block">
            <span className={labelClass}>Cover image path (optional)</span>
            <input
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder="/covers/asthma.png"
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Article body</span>
            <p className="text-xs text-brand-charcoal/60">
              Separate paragraphs with a blank line.
            </p>
            <textarea
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
              required
              className={textAreaClass}
            />
          </label>
        </>
      ) : null}

      {type === "link" ? (
        <>
          <label className="block">
            <span className={labelClass}>Original article URL</span>
            <input
              type="url"
              value={externalUrl}
              onChange={(event) => setExternalUrl(event.target.value)}
              required
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Publisher / source name</span>
            <input
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
              placeholder="Wellness Mama"
              className={fieldClass}
            />
          </label>

          <label className="block">
            <span className={labelClass}>Your commentary</span>
            <p className="text-xs text-brand-charcoal/60">
              Make clear you are sharing the article, not claiming authorship. Separate
              paragraphs with a blank line.
            </p>
            <textarea
              value={commentaryText}
              onChange={(event) => setCommentaryText(event.target.value)}
              required
              className={textAreaClass}
            />
          </label>
        </>
      ) : null}

      {type === "roundup" ? (
        <>
          <label className="block">
            <span className={labelClass}>Intro (optional)</span>
            <textarea
              value={introText}
              onChange={(event) => setIntroText(event.target.value)}
              className={textAreaClass}
            />
          </label>

          <div className="space-y-4">
            <p className={labelClass}>Roundup links</p>
            {links.map((link, index) => (
              <div
                key={index}
                className="rounded-2xl border border-brand-brown/15 bg-cream-deep p-4"
              >
                <label className="block">
                  <span className="text-xs font-bold text-brand-charcoal">Title</span>
                  <input
                    value={link.title}
                    onChange={(event) => {
                      const next = [...links];
                      next[index] = { ...next[index], title: event.target.value };
                      setLinks(next);
                    }}
                    className={fieldClass}
                  />
                </label>
                <label className="mt-3 block">
                  <span className="text-xs font-bold text-brand-charcoal">URL</span>
                  <input
                    type="url"
                    value={link.url}
                    onChange={(event) => {
                      const next = [...links];
                      next[index] = { ...next[index], url: event.target.value };
                      setLinks(next);
                    }}
                    className={fieldClass}
                  />
                </label>
                <label className="mt-3 block">
                  <span className="text-xs font-bold text-brand-charcoal">Source</span>
                  <input
                    value={link.source ?? ""}
                    onChange={(event) => {
                      const next = [...links];
                      next[index] = { ...next[index], source: event.target.value };
                      setLinks(next);
                    }}
                    className={fieldClass}
                  />
                </label>
                <label className="mt-3 block">
                  <span className="text-xs font-bold text-brand-charcoal">Why we saved it</span>
                  <textarea
                    value={link.blurb ?? ""}
                    onChange={(event) => {
                      const next = [...links];
                      next[index] = { ...next[index], blurb: event.target.value };
                      setLinks(next);
                    }}
                    className={textAreaClass}
                  />
                </label>
                {links.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setLinks(links.filter((_, itemIndex) => itemIndex !== index))}
                    className="mt-3 text-sm font-bold text-red-600"
                  >
                    Remove link
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLinks([...links, { ...defaultLink }])}
              className="rounded-xl border border-brand-brown/20 bg-white px-4 py-2 text-sm font-bold text-brand-charcoal"
            >
              Add another link
            </button>
          </div>
        </>
      ) : null}

      {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-green-deep px-5 text-sm font-bold text-white transition hover:brightness-95 disabled:cursor-wait disabled:opacity-70"
      >
        {loading ? "Saving..." : mode === "create" ? "Publish post" : "Save changes"}
      </button>
    </form>
  );
}

export function buildPostPayload(values: AdminPostFormValues) {
  const payload: Record<string, unknown> = {
    slug: values.slug,
    type: values.type,
    title: values.title,
    excerpt: values.excerpt,
    category: values.category,
    publishedAt: values.publishedAt,
  };

  if (values.dateLabel) payload.dateLabel = values.dateLabel;
  if (values.authorId) payload.authorId = values.authorId;
  if (values.imageUrl) payload.imageUrl = values.imageUrl;

  if (values.type === "article") {
    payload.body = splitParagraphs(values.bodyText);
  }

  if (values.type === "link") {
    payload.externalUrl = values.externalUrl;
    if (values.sourceName) payload.sourceName = values.sourceName;
    payload.commentary = splitParagraphs(values.commentaryText);
  }

  if (values.type === "roundup") {
    payload.intro = splitParagraphs(values.introText);
    payload.links = values.links
      .map((link) => ({
        title: link.title.trim(),
        url: link.url.trim(),
        source: link.source?.trim() || undefined,
        blurb: link.blurb?.trim() || undefined,
      }))
      .filter((link) => link.title && link.url);
  }

  return payload;
}

export function paragraphsToText(paragraphs?: string[]) {
  return (paragraphs ?? []).join("\n\n");
}
