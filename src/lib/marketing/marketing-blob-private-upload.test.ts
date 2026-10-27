import assert from "node:assert/strict";
import { test } from "node:test";
import {
  syntheticMarketingPublicBlobUrl,
  uploadPrivateMarketingPublicImage,
} from "./marketing-blob";
import { readFileSync } from "node:fs";
import path from "node:path";

test("syntheticMarketingPublicBlobUrl binds pathname to trusted reference host", () => {
  const ref =
    "https://Q7Bbz4IQuVq0GO24.public.blob.vercel-storage.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
  const pathname = "marketing/public/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png";
  const url = syntheticMarketingPublicBlobUrl(pathname, ref);
  assert.equal(
    url.toLowerCase(),
    "https://q7bbz4iquvq0go24.public.blob.vercel-storage.com/marketing/public/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
  );
});

test("uploadPrivateMarketingPublicImage stores locally without public server put", async () => {
  const ref =
    "https://Q7Bbz4IQuVq0GO24.public.blob.vercel-storage.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
  const uploaded = await uploadPrivateMarketingPublicImage(
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    "image/png",
    ".png",
    ref,
  );
  assert.equal(uploaded.storage, "local");
  assert.match(uploaded.pathname, /^local-public\//);
  assert.match(uploaded.url, /^\/marketing-uploads\//);
});

test("marketing-blob private marketing public upload uses access private", () => {
  const source = readFileSync(path.join(process.cwd(), "src/lib/marketing/marketing-blob.ts"), "utf8");
  const fn = source.slice(
    source.indexOf("export async function uploadPrivateMarketingPublicImage"),
    source.indexOf("export async function uploadPublicMarketingFile"),
  );
  assert.match(fn, /access:\s*"private"/);
  assert.doesNotMatch(fn, /access:\s*"public"/);
});
