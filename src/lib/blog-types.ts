export type BlogPostType = "article" | "link" | "roundup";

const typeLabels: Record<BlogPostType, string> = {
  article: "Article",
  link: "Link share",
  roundup: "Reading roundup",
};

export function getPostTypeLabel(type: BlogPostType): string {
  return typeLabels[type];
}

export function isSharedBlogPost(type: BlogPostType): boolean {
  return type === "link" || type === "roundup";
}
