import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WeeklyVisualPreview } from "./WeeklyVisualPreview";
import type { WeeklyItemReview } from "@/lib/marketing/weekly-review";

const visualReview: WeeklyItemReview = {
  channelLabel: "Pinterest · Pin · Vertical",
  showVisualPreview: true,
  previewUrl: "https://twilight-feather.com/covers/sickle-cell.png",
  dimensionsLabel: "1009 × 1024 · 1009:1024",
  visualSuitabilityWarning: "Visual is not suitable for Pinterest · Pin · Vertical.",
};

test("WeeklyVisualPreview renders selected asset src and dimensions", () => {
  const html = renderToStaticMarkup(
    <WeeklyVisualPreview review={visualReview} title="Test pin" />,
  );
  assert.match(html, /covers\/sickle-cell\.png/);
  assert.match(html, /1009 × 1024/);
  assert.match(html, /not suitable/);
});

test("WeeklyVisualPreview renders nothing for non-visual review", () => {
  const html = renderToStaticMarkup(
    <WeeklyVisualPreview
      review={{
        channelLabel: "Email · Email",
        showVisualPreview: false,
        previewUrl: null,
        dimensionsLabel: null,
        visualSuitabilityWarning: null,
      }}
      title="Newsletter"
    />,
  );
  assert.equal(html, "");
});

test("WeeklyVisualPreview renders nothing when visual but URL missing", () => {
  const html = renderToStaticMarkup(
    <WeeklyVisualPreview
      review={{
        channelLabel: "Instagram · Post",
        showVisualPreview: true,
        previewUrl: null,
        dimensionsLabel: null,
        visualSuitabilityWarning: null,
      }}
      title="Post"
    />,
  );
  assert.equal(html, "");
});
