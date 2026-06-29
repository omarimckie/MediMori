"use client";

import {
  AdminPostForm,
  buildPostPayload,
  paragraphsToText,
  type AdminPostFormValues,
} from "@/components/admin/AdminPostForm";
import { AdminShell } from "@/components/admin/AdminShell";
import type { BlogPostType } from "@/lib/blog-types";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type StoredPost = {
  slug: string;
  type: BlogPostType;
  title: string;
  excerpt: string;
  category: string;
  publishedAt: string;
  dateLabel?: string;
  authorId?: string;
  imageUrl?: string;
  body?: string[];
  externalUrl?: string;
  sourceName?: string;
  commentary?: string[];
  intro?: string[];
  links?: { title: string; url: string; source?: string; blurb?: string }[];
};

export default function AdminEditPostPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const [initialValues, setInitialValues] = useState<Partial<AdminPostFormValues> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPost() {
      const response = await fetch(`/api/admin/posts/${params.slug}`);
      const data = (await response.json()) as { post?: StoredPost; error?: string };

      if (!response.ok || !data.post) {
        setError(data.error ?? "Post not found in admin store.");
        return;
      }

      const post = data.post;
      setInitialValues({
        slug: post.slug,
        type: post.type,
        title: post.title,
        excerpt: post.excerpt,
        category: post.category,
        publishedAt: post.publishedAt,
        dateLabel: post.dateLabel ?? "",
        authorId: post.authorId ?? "",
        imageUrl: post.imageUrl ?? "",
        bodyText: paragraphsToText(post.body),
        externalUrl: post.externalUrl ?? "",
        sourceName: post.sourceName ?? "",
        commentaryText: paragraphsToText(post.commentary),
        introText: paragraphsToText(post.intro),
        links: post.links ?? [],
      });
    }

    void loadPost();
  }, [params.slug]);

  async function handleSubmit(values: AdminPostFormValues) {
    const response = await fetch(`/api/admin/posts/${params.slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPostPayload(values)),
    });

    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Could not save post.");
    }

    router.push("/admin");
    router.refresh();
  }

  async function handleDelete() {
    if (!window.confirm("Delete this post from the admin store?")) return;

    const response = await fetch(`/api/admin/posts/${params.slug}`, {
      method: "DELETE",
    });

    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not delete post.");
      return;
    }

    router.push("/admin");
    router.refresh();
  }

  return (
    <AdminShell
      title="Edit blog post"
      actions={
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="inline-flex h-10 items-center rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-bold text-red-700 transition hover:bg-red-100"
        >
          Delete
        </button>
      }
    >
      <div className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm sm:p-8">
        {error ? (
          <p className="text-sm font-semibold text-red-600">{error}</p>
        ) : initialValues ? (
          <AdminPostForm
            mode="edit"
            initialValues={initialValues}
            onSubmit={handleSubmit}
          />
        ) : (
          <p className="text-sm text-brand-charcoal/70">Loading post...</p>
        )}
      </div>
    </AdminShell>
  );
}
