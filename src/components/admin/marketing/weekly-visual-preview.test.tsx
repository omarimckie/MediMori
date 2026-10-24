import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WeeklyVisualPreview } from "./WeeklyVisualPreview";
import type { WeeklyItemReview } from "@/lib/marketing/weekly-review";

const websiteDestinationStub = {
  destinationPath: "/books/book-one",
  sitePageUrl: "https://twilight-feather.com/books/book-one",
  trackingLink: "https://twilight-feather.com/api/m/tok",
  platformNavigationSummary: "Pinterest pin link uses the tracked /api/m URL.",
  warnings: [] as string[],
};

const visualReview: WeeklyItemReview = {
  channelLabel: "Pinterest · Pin · Vertical",
  showVisualPreview: true,
  previewUrl: "https://twilight-feather.com/covers/sickle-cell.png",
  dimensionsLabel: "1009 × 1024 · 1009:1024",
  visualSuitabilityWarning: "Visual is not suitable for Pinterest · Pin · Vertical.",
  websiteDestination: websiteDestinationStub,
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
        websiteDestination: websiteDestinationStub,
      }}
      title="Newsletter"
    />,
  );
  assert.equal(html, "");
});

test("WeeklyVisualPreview renders a public Blob URL only when preview images are allowed", () => {
  const blob =
    "https://store.public.blob.vercel-storage.com/marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";
  const review = { ...visualReview, previewUrl: blob, dimensionsLabel: null, visualSuitabilityWarning: null };
  const blocked = renderToStaticMarkup(
    <WeeklyVisualPreview review={review} title="Amara" />,
  );
  assert.equal(blocked, "");
  const allowed = renderToStaticMarkup(
    <WeeklyVisualPreview review={review} title="Amara" allowPublicBlobPreview />,
  );
  assert.match(allowed, /store\.public\.blob\.vercel-storage\.com/);
  assert.match(allowed, /referrerPolicy="no-referrer"/i);
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
        websiteDestination: websiteDestinationStub,
      }}
      title="Post"
    />,
  );
  assert.equal(html, "");
});
