"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import { getPostTypeLabel } from "@/lib/blog-types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type StoredPost = {
  slug: string;
  type: "article" | "link" | "roundup";
  title: string;
  excerpt: string;
  publishedAt: string;
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const [posts, setPosts] = useState<StoredPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  async function loadPosts() {
    setLoading(true);
    const response = await fetch("/api/admin/posts");
    if (response.status === 401) {
      router.push("/admin/login");
      return;
    }

    const data = (await response.json()) as { posts?: StoredPost[] };
    setPosts(data.posts ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void loadPosts();
  }, []);

  async function seedStarterPosts() {
    setMessage(null);
    const response = await fetch("/api/admin/seed", { method: "POST" });
    const data = (await response.json()) as { added?: number; error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "Could not import starter posts.");
      return;
    }

    setMessage(
      data.added
        ? `Imported ${data.added} starter post(s) into the admin store.`
        : "Starter posts were already in the admin store.",
    );
    await loadPosts();
  }

  return (
    <AdminShell
      title="Blog posts"
      actions={
        <Link
          href="/admin/posts/new"
          className="inline-flex h-10 items-center rounded-xl bg-brand-green-deep px-4 text-sm font-bold text-white transition hover:brightness-95"
        >
          New post
        </Link>
      }
    >
      <div className="rounded-3xl border border-brand-brown/15 bg-white p-6 shadow-sm">
        <p className="text-sm text-brand-charcoal/75">
          Posts you create here publish immediately on the public blog. Starter posts
          from <code className="rounded bg-cream-deep px-1">blog.json</code> still show
          on the site, but only admin-store posts can be edited here.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void seedStarterPosts()}
            className="inline-flex h-10 items-center rounded-xl border border-brand-brown/20 bg-cream-deep px-4 text-sm font-bold text-brand-charcoal transition hover:bg-white"
          >
            Import starter posts for editing
          </button>
        </div>

        {message ? (
          <p className="mt-4 rounded-2xl bg-brand-green/10 px-4 py-3 text-sm font-semibold text-brand-charcoal">
            {message}
          </p>
        ) : null}
      </div>

      <div className="mt-8">
        {loading ? (
          <p className="text-sm text-brand-charcoal/70">Loading posts...</p>
        ) : posts.length ? (
          <ul className="space-y-4">
            {posts.map((post) => (
              <li
                key={post.slug}
                className="rounded-3xl border border-brand-brown/15 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-brand-green-deep">
                      {getPostTypeLabel(post.type)}
                    </p>
                    <h2 className="mt-1 text-xl font-extrabold text-brand-charcoal">
                      {post.title}
                    </h2>
                    <p className="mt-2 text-sm text-brand-charcoal/75">{post.excerpt}</p>
                    <p className="mt-2 text-xs font-semibold text-brand-charcoal/55">
                      /blog/{post.slug}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/blog/${post.slug}`}
                      className="inline-flex h-10 items-center rounded-xl border border-brand-brown/20 bg-white px-4 text-sm font-bold text-brand-charcoal transition hover:bg-cream-deep"
                    >
                      View
                    </Link>
                    <Link
                      href={`/admin/posts/${post.slug}/edit`}
                      className="inline-flex h-10 items-center rounded-xl bg-brand-yellow-bright px-4 text-sm font-bold text-section-navy transition hover:brightness-95"
                    >
                      Edit
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-3xl border border-dashed border-brand-brown/25 bg-white p-8 text-center">
            <p className="text-sm text-brand-charcoal/75">
              No admin-created posts yet. Create your first post or import the starter
              posts so you can edit them here.
            </p>
            <Link
              href="/admin/posts/new"
              className="mt-4 inline-flex h-11 items-center rounded-xl bg-brand-green-deep px-5 text-sm font-bold text-white transition hover:brightness-95"
            >
              Create a post
            </Link>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
