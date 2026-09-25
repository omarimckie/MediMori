import { del, put } from "@vercel/blob";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { issueSignedToken, presignUrl } from "@vercel/blob";

export const MARKETING_SIGNED_URL_TTL_MS = 10 * 60 * 1000;

const LOCAL_PUBLIC_ROOT = path.join(process.cwd(), "public", "marketing-uploads");
const LOCAL_PRIVATE_ROOT = path.join(process.cwd(), "private", "marketing-uploads");

function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function randomSegment(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export type PublicUploadResult = {
  url: string;
  pathname: string;
  storage: "blob" | "local";
};

export type PrivateUploadResult = {
  pathname: string;
  storage: "blob" | "local";
};

export async function uploadPublicMarketingFile(
  buffer: Buffer,
  mime: string,
  extension: string,
): Promise<PublicUploadResult> {
  const pathname = `marketing/public/${randomSegment()}${extension}`;
  if (hasBlobToken()) {
    const blob = await put(pathname, buffer, {
      access: "public",
      contentType: mime,
      addRandomSuffix: false,
    });
    return { url: blob.url, pathname, storage: "blob" };
  }
  const fileName = `${randomSegment()}${extension}`;
  const dir = path.join(LOCAL_PUBLIC_ROOT);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await writeFile(filePath, buffer);
  return { url: `/marketing-uploads/${fileName}`, pathname: `local-public/${fileName}`, storage: "local" };
}

export async function uploadPrivateMarketingFile(
  buffer: Buffer,
  mime: string,
  extension: string,
): Promise<PrivateUploadResult> {
  const pathname = `marketing/private/${randomSegment()}${extension}`;
  if (hasBlobToken()) {
    await put(pathname, buffer, {
      access: "private",
      contentType: mime,
      addRandomSuffix: false,
    });
    return { pathname, storage: "blob" };
  }
  const fileName = `${randomSegment()}${extension}`;
  const dir = path.join(LOCAL_PRIVATE_ROOT);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), buffer);
  return { pathname: `local-private/${fileName}`, storage: "local" };
}

/**
 * Returns a blob pathname only when it can be derived unambiguously from a stored URL.
 * Unknown or third-party URLs return null (no deletion attempted).
 */
export function tryResolveMarketingBlobPathnameFromUrl(url: string | null): string | null {
  if (!url?.trim()) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith("/marketing-uploads/")) {
    const fileName = trimmed.slice("/marketing-uploads/".length);
    if (!fileName || fileName.includes("..") || fileName.includes("/")) return null;
    return `local-public/${fileName}`;
  }
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (!parsed.hostname.endsWith(".blob.vercel-storage.com")) return null;
    const pathname = parsed.pathname.replace(/^\//, "");
    if (!pathname.startsWith("marketing/public/")) return null;
    if (pathname.includes("..")) return null;
    return pathname;
  } catch {
    return null;
  }
}

export async function deleteMarketingBlob(pathname: string): Promise<void> {
  if (pathname.startsWith("local-public/")) {
    const fileName = pathname.replace("local-public/", "");
    try {
      await unlink(path.join(LOCAL_PUBLIC_ROOT, fileName));
    } catch {
      // ignore missing file
    }
    return;
  }
  if (pathname.startsWith("local-private/")) {
    const fileName = pathname.replace("local-private/", "");
    try {
      await unlink(path.join(LOCAL_PRIVATE_ROOT, fileName));
    } catch {
      // ignore
    }
    return;
  }
  if (!hasBlobToken()) return;
  try {
    await del(pathname);
  } catch {
    // best-effort cleanup
  }
}

export async function readLocalPrivateMarketingFile(pathname: string): Promise<Buffer | null> {
  if (!pathname.startsWith("local-private/")) return null;
  const fileName = pathname.replace("local-private/", "");
  try {
    const { readFile } = await import("node:fs/promises");
    return await readFile(path.join(LOCAL_PRIVATE_ROOT, fileName));
  } catch {
    return null;
  }
}

export async function createPrivateMarketingDownloadUrl(pathname: string): Promise<string> {
  const validUntil = Date.now() + MARKETING_SIGNED_URL_TTL_MS;
  const signedToken = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "get",
    pathname,
    access: "private",
    validUntil,
  });
  return presignedUrl;
}
