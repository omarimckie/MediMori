import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const clientSources = [
  "CalendarClient.tsx",
  "CalendarPublicationDetailModal.tsx",
].map((file) =>
  readFileSync(new URL(`./${file}`, import.meta.url), "utf8"),
);

test("calendar client components do not import server-only recycle module", () => {
  for (const source of clientSources) {
    assert.doesNotMatch(source, /from ["']@\/lib\/marketing\/recycle["']/);
    assert.doesNotMatch(source, /from ["']@\/lib\/marketing\/asset-truth["']/);
  }
});
