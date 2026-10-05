import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  getMarketingPageGuide,
  MARKETING_PAGE_GUIDE_IDS,
  MARKETING_PAGE_GUIDES,
} from "./marketing-page-guides";

test("every nav guide id has a complete entry", () => {
  const required = [
    "overview",
    "week",
    "report",
    "smart-upload",
    "campaigns",
    "content",
    "calendar",
    "assets",
    "analytics",
    "recommendations",
    "brain",
    "costs",
  ] as const;
  for (const id of required) {
    const entry = getMarketingPageGuide(id);
    assert.equal(entry.id, id);
    assert.ok(entry.purpose.length > 20);
    assert.ok(entry.actions.length >= 2);
    assert.ok(entry.notes.length >= 1);
  }
  assert.deepEqual(MARKETING_PAGE_GUIDE_IDS.sort(), [...required].sort());
});

test("analytics guide states Meta Insights are not ingested", () => {
  const notes = MARKETING_PAGE_GUIDES.analytics.notes.join(" ");
  assert.match(notes, /Meta Insights/i);
  assert.match(notes, /not ingest/i);
});

test("recommendations guide states accept does not auto-change plans", () => {
  const notes = MARKETING_PAGE_GUIDES.recommendations.notes.join(" ");
  assert.match(notes, /does not automatically change plans/i);
});

test("costs guide states estimates are incomplete", () => {
  const notes = MARKETING_PAGE_GUIDES.costs.notes.join(" ");
  assert.match(notes, /incomplete/i);
  assert.match(notes, /Smart Upload caption/i);
});

test("MarketingPageGuide component does not call publishing APIs", () => {
  const file = path.join(
    process.cwd(),
    "src/components/admin/marketing/MarketingPageGuide.tsx",
  );
  const source = readFileSync(file, "utf8");
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /publishDue|publishPublication|marketing-publish/i);
});
