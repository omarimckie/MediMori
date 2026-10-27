import type { BlogPost } from "@/lib/blog";
import { list, put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type BlogPostInput = Omit<BlogPost, "authorId"> & {
  authorId?: string;
};

type BlogStoreFile = {
  posts: BlogPostInput[];
};

const BLOB_PATHNAME = "blog/posts.json";
const LOCAL_STORE_PATH = path.join(process.cwd(), "private", "blog-posts.json");

function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

async function readLocalStore(): Promise<BlogPostInput[]> {
  try {
    const raw = await readFile(LOCAL_STORE_PATH, "utf8");
    const data = JSON.parse(raw) as BlogStoreFile;
    return Array.isArray(data.posts) ? data.posts : [];
  } catch {
    return [];
  }
}

async function writeLocalStore(posts: BlogPostInput[]): Promise<void> {
  await mkdir(path.dirname(LOCAL_STORE_PATH), { recursive: true });
  const payload: BlogStoreFile = { posts };
  await writeFile(LOCAL_STORE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readBlobStore(): Promise<BlogPostInput[]> {
  const { blobs } = await list({ prefix: "blog/", limit: 20 });
  const storeBlob = blobs.find((blob) => blob.pathname === BLOB_PATHNAME);
  if (!storeBlob) return [];

  const response = await fetch(storeBlob.url, { cache: "no-store" });
  if (!response.ok) return [];

  const data = (await response.json()) as BlogStoreFile;
  return Array.isArray(data.posts) ? data.posts : [];
}

async function writeBlobStore(posts: BlogPostInput[]): Promise<void> {
  const payload: BlogStoreFile = { posts };
  await put(BLOB_PATHNAME, JSON.stringify(payload, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function readStoredPosts(): Promise<BlogPostInput[]> {
  if (hasBlobToken()) {
    try {
      return await readBlobStore();
    } catch {
      return readLocalStore();
    }
  }

  return readLocalStore();
}

export async function writeStoredPosts(posts: BlogPostInput[]): Promise<void> {
  if (hasBlobToken()) {
    try {
      await writeBlobStore(posts);
      return;
    } catch {
      await writeLocalStore(posts);
      return;
    }
  }

  await writeLocalStore(posts);
}

export async function upsertStoredPost(post: BlogPostInput): Promise<void> {
  const posts = await readStoredPosts();
  const index = posts.findIndex((entry) => entry.slug === post.slug);
  const next = [...posts];

  if (index >= 0) {
    next[index] = post;
  } else {
    next.push(post);
  }

  await writeStoredPosts(next);
}

export async function deleteStoredPost(slug: string): Promise<boolean> {
  const posts = await readStoredPosts();
  const next = posts.filter((post) => post.slug !== slug);
  if (next.length === posts.length) return false;
  await writeStoredPosts(next);
  return true;
}

export async function mergeSeedPosts(seedPosts: BlogPostInput[]): Promise<number> {
  const existing = await readStoredPosts();
  const slugs = new Set(existing.map((post) => post.slug));
  const toAdd = seedPosts.filter((post) => !slugs.has(post.slug));

  if (!toAdd.length) return 0;

  await writeStoredPosts([...existing, ...toAdd]);
  return toAdd.length;
}
