import blogData from "@/data/blog.json";
import { DEFAULT_BLOG_AUTHOR_ID, getAuthorById, type Author } from "@/lib/authors";
import { readStoredPosts } from "@/lib/blog-store";
import type { BlogPostType } from "@/lib/blog-types";

export type { BlogPostType } from "@/lib/blog-types";
export { getPostTypeLabel, isSharedBlogPost } from "@/lib/blog-types";

export type BlogRoundupLink = {
  title: string;
  url: string;
  source?: string;
  blurb?: string;
};

export type BlogPost = {
  slug: string;
  type: BlogPostType;
  authorId: string;
  title: string;
  excerpt: string;
  category: string;
  publishedAt: string;
  dateLabel?: string;
  imageUrl?: string;
  body?: string[];
  externalUrl?: string;
  sourceName?: string;
  commentary?: string[];
  intro?: string[];
  links?: BlogRoundupLink[];
};

type BlogPostRecord = Omit<BlogPost, "authorId"> & {
  authorId?: string;
};

type BlogDataFile = {
  posts: BlogPostRecord[];
};

function resolveAuthorId(authorId?: string): string {
  const trimmed = authorId?.trim();
  return trimmed || DEFAULT_BLOG_AUTHOR_ID;
}

function normalizePost(post: BlogPostRecord): BlogPost {
  return {
    ...post,
    authorId: resolveAuthorId(post.authorId),
  };
}

function sortPosts(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

function mergePosts(staticPosts: BlogPostRecord[], storedPosts: BlogPostRecord[]): BlogPost[] {
  const bySlug = new Map<string, BlogPostRecord>();

  for (const post of staticPosts) {
    bySlug.set(post.slug, post);
  }

  for (const post of storedPosts) {
    bySlug.set(post.slug, post);
  }

  return sortPosts([...bySlug.values()].map(normalizePost));
}

function getStaticPosts(): BlogPostRecord[] {
  return (blogData as BlogDataFile).posts;
}

export async function getPosts(): Promise<BlogPost[]> {
  const storedPosts = await readStoredPosts();
  return mergePosts(getStaticPosts(), storedPosts);
}

export async function getPostBySlug(slug: string): Promise<BlogPost | undefined> {
  const posts = await getPosts();
  return posts.find((post) => post.slug === slug);
}

export function getPostAuthor(post: BlogPost): Author | undefined {
  return getAuthorById(post.authorId);
}

export function formatPostDate(post: BlogPost): string {
  if (post.dateLabel) return post.dateLabel;

  return new Date(post.publishedAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function getStaticSeedPosts(): BlogPostRecord[] {
  return getStaticPosts();
}
