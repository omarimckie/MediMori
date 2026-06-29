import blogData from "@/data/blog.json";
import { getAuthorById, type Author } from "@/lib/authors";

export type BlogPostType = "article" | "link" | "roundup";

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

type BlogDataFile = {
  posts: BlogPost[];
};

const typeLabels: Record<BlogPostType, string> = {
  article: "Article",
  link: "Link share",
  roundup: "Reading roundup",
};

export function getPostTypeLabel(type: BlogPostType): string {
  return typeLabels[type];
}

export function getPosts(): BlogPost[] {
  return [...(blogData as BlogDataFile).posts].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return getPosts().find((post) => post.slug === slug);
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
