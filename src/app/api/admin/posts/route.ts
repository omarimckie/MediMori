import { isAdminAuthenticated } from "@/lib/admin-auth";
import type { BlogPostInput } from "@/lib/blog-store";
import { readStoredPosts, upsertStoredPost } from "@/lib/blog-store";
import type { BlogPostType } from "@/lib/blog";
import { slugify } from "@/lib/slugify";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function isPostType(value: unknown): value is BlogPostType {
  return value === "article" || value === "link" || value === "roundup";
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return items.length ? items : undefined;
}

function parsePostBody(body: unknown): BlogPostInput | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "Invalid request body." };
  }

  const data = body as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const excerpt = typeof data.excerpt === "string" ? data.excerpt.trim() : "";
  const category = typeof data.category === "string" ? data.category.trim() : "";
  const publishedAt =
    typeof data.publishedAt === "string" ? data.publishedAt.trim() : "";
  const type = data.type;

  if (!title || !excerpt || !category || !publishedAt || !isPostType(type)) {
    return { error: "Title, excerpt, category, publishedAt, and type are required." };
  }

  const slugInput = typeof data.slug === "string" ? data.slug.trim() : "";
  const slug = slugify(slugInput || title);
  if (!slug) {
    return { error: "Could not generate a valid slug." };
  }

  const post: BlogPostInput = {
    slug,
    type,
    title,
    excerpt,
    category,
    publishedAt,
  };

  if (typeof data.dateLabel === "string" && data.dateLabel.trim()) {
    post.dateLabel = data.dateLabel.trim();
  }

  if (typeof data.authorId === "string" && data.authorId.trim()) {
    post.authorId = data.authorId.trim();
  }

  if (typeof data.imageUrl === "string" && data.imageUrl.trim()) {
    post.imageUrl = data.imageUrl.trim();
  }

  if (type === "article") {
    post.body = parseStringArray(data.body) ?? [];
    if (!post.body.length) {
      return { error: "Articles need at least one paragraph in body." };
    }
  }

  if (type === "link") {
    const externalUrl =
      typeof data.externalUrl === "string" ? data.externalUrl.trim() : "";
    if (!externalUrl) {
      return { error: "Link shares need an external URL." };
    }

    post.externalUrl = externalUrl;
    if (typeof data.sourceName === "string" && data.sourceName.trim()) {
      post.sourceName = data.sourceName.trim();
    }
    post.commentary = parseStringArray(data.commentary) ?? [];
    if (!post.commentary.length) {
      return { error: "Link shares need at least one commentary paragraph." };
    }
  }

  if (type === "roundup") {
    post.intro = parseStringArray(data.intro);
    if (!Array.isArray(data.links) || !data.links.length) {
      return { error: "Roundups need at least one link." };
    }

    post.links = data.links
      .map((item) => {
        if (typeof item !== "object" || item === null) return null;
        const link = item as Record<string, unknown>;
        const linkTitle = typeof link.title === "string" ? link.title.trim() : "";
        const url = typeof link.url === "string" ? link.url.trim() : "";
        if (!linkTitle || !url) return null;

        return {
          title: linkTitle,
          url,
          source: typeof link.source === "string" ? link.source.trim() : undefined,
          blurb: typeof link.blurb === "string" ? link.blurb.trim() : undefined,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (!post.links.length) {
      return { error: "Each roundup link needs a title and URL." };
    }
  }

  return post;
}

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const posts = await readStoredPosts();
  return NextResponse.json({ posts });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parsePostBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const existing = await readStoredPosts();
  if (existing.some((post) => post.slug === parsed.slug)) {
    return NextResponse.json(
      { error: "A post with this slug already exists." },
      { status: 409 },
    );
  }

  await upsertStoredPost(parsed);
  return NextResponse.json({ post: parsed }, { status: 201 });
}
