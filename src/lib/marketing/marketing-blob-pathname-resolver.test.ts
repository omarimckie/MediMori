import assert from "node:assert/strict";
import { test } from "node:test";
import { tryResolveMarketingBlobPathnameFromUrl } from "./marketing-blob";

const VALID =
  "https://store123.public.blob.vercel-storage.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";

test("valid synthetic Blob URL resolves to allowed pathname", () => {
  assert.equal(
    tryResolveMarketingBlobPathnameFromUrl(VALID),
    "marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
  );
});

test("hostile hostname evilblob.vercel-storage.com.example.com is rejected", () => {
  assert.equal(
    tryResolveMarketingBlobPathnameFromUrl(
      "https://evilblob.vercel-storage.com.example.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
    ),
    null,
  );
});

test("encoded traversal %2e%2e is rejected", () => {
  assert.equal(
    tryResolveMarketingBlobPathnameFromUrl(
      "https://store.public.blob.vercel-storage.com/marketing/public/%2e%2e/private/secret.png",
    ),
    null,
  );
});

test("normal ../ traversal is rejected", () => {
  assert.equal(
    tryResolveMarketingBlobPathnameFromUrl(
      "https://store.public.blob.vercel-storage.com/marketing/public/../private/secret.png",
    ),
    null,
  );
});

test("external HTTPS URL containing marketing/public path is rejected", () => {
  assert.equal(
    tryResolveMarketingBlobPathnameFromUrl(
      "https://cdn.example.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
    ),
    null,
  );
});

test("proxy URL fed back into resolver is rejected", () => {
  assert.equal(
    tryResolveMarketingBlobPathnameFromUrl(
      "https://twilight-feather.com/api/marketing/assets/239a03b0-2182-4a21-a997-052514c1cec4/image",
    ),
    null,
  );
});

test("query string does not alter derived pathname", () => {
  assert.equal(
    tryResolveMarketingBlobPathnameFromUrl(`${VALID}?cacheBust=1`),
    "marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
  );
});

test("fragment does not alter pathname", () => {
  assert.equal(
    tryResolveMarketingBlobPathnameFromUrl(`${VALID}#fragment`),
    "marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
  );
});
