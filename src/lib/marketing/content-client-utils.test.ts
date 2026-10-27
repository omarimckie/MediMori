import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contentBodyExcerpt,
  contentDisplayTitle,
  formatContentWeekLabel,
  formatScheduledPublishLabel,
  formatWeekPlanSelectorLabel,
  isContentTitleRedundantWithBody,
  pickOperationalWeeklyPlanId,
  shouldShowScheduledPublishOnWeekCard,
} from "./content-client-utils";

test("contentBodyExcerpt truncates long body", () => {
  const long = "a".repeat(300);
  const excerpt = contentBodyExcerpt(long, 50);
  assert.equal(excerpt.length, 51);
  assert.match(excerpt, /…$/);
});

test("contentBodyExcerpt is word-safe", () => {
  const body = "stories that help families talk about asthma and wellness together every day";
  const excerpt = contentBodyExcerpt(body, 30);
  assert.match(excerpt, /…$/);
  assert.doesNotMatch(excerpt, /tha…$/);
});

test("redundant title hides separate heading", () => {
  const body = "Facebook Phase 4C Test Caption\n\nFacebook CTA Test";
  assert.equal(isContentTitleRedundantWithBody("Facebook Phase 4C Test Caption", body), true);
  assert.equal(contentDisplayTitle("Facebook Phase 4C Test Caption", body), null);
});

test("distinct title remains visible", () => {
  const body = "Body copy for the post.";
  assert.equal(isContentTitleRedundantWithBody("Campaign headline", body), false);
  assert.equal(contentDisplayTitle("Campaign headline", body), "Campaign headline");
});

test("scheduled week card shows publish label when scheduled", () => {
  const iso = "2026-10-05T23:00:00.000Z";
  assert.equal(
    shouldShowScheduledPublishOnWeekCard(
      { status: "scheduled", scheduledFor: iso },
      "scheduled",
    ),
    true,
  );
  const label = formatScheduledPublishLabel(iso, "America/New_York");
  assert.match(label, /^Publishes:/);
  assert.match(label, /Oct/);
});

test("unscheduled card does not show misleading publish datetime helper", () => {
  assert.equal(
    shouldShowScheduledPublishOnWeekCard(
      { status: "approved", scheduledFor: null },
      undefined,
    ),
    false,
  );
});

test("formatContentWeekLabel unassigned", () => {
  const result = formatContentWeekLabel(null, []);
  assert.equal(result.label, "Unassigned");
});

test("formatContentWeekLabel assigned plan", () => {
  const result = formatContentWeekLabel("p1", [{ id: "p1", weekStart: "2026-04-07" }]);
  assert.equal(result.label, "Week of 2026-04-07");
});

test("no-week empty state copy references New Week", () => {
  const message =
    "No weekly plans are available yet. Create an empty week from Your Week, or generate a campaign package.";
  assert.match(message, /Your Week/i);
});

test("pickOperationalWeeklyPlanId and week labels", () => {
  const plans = [
    { id: "a", weekStart: "2026-09-14" },
    { id: "b", weekStart: "2026-10-05" },
  ];
  assert.equal(pickOperationalWeeklyPlanId(plans, "2026-10-04"), "b");
  assert.match(formatWeekPlanSelectorLabel("2026-10-05", "2026-10-04"), /Upcoming/);
});
