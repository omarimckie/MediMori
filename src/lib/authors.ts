import { authors, type Author } from "@/data/authors";

export type { Author };

export function getAuthors(): Author[] {
  return authors;
}

export function getAuthorById(id: string): Author | undefined {
  return authors.find((author) => author.id === id);
}

export function getAuthorProfileHref(authorId: string): string {
  return `/authors?author=${authorId}`;
}
