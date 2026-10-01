import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ContentReviewCardActions,
  reviewScheduleModalState,
} from "./ContentReviewCardActions";
import { ScheduleContentModal } from "./ScheduleContentModal";
import { shouldShowRecycleOnReviewCard } from "@/lib/marketing/recycle-eligibility";
import { executeMarketingContentPostAction } from "@/lib/marketing/content-post-action";
import {
  approveContent,
  publishPublication,
  scheduleApproved,
} from "@/lib/marketing/approval";
import { MemoryMarketingStore } from "@/lib/marketing/memory-store";
import type { MarketingContent } from "@/lib/marketing/types";

const noop = () => {};

function renderActions(input: {
  status: string;
  platform: MarketingContent["platform"];
  format: MarketingContent["format"];
  hasPublishedPublication: boolean;
}) {
  return renderToStaticMarkup(
    <ContentReviewCardActions
      item={{
        id: "content-1",
        status: input.status,
        platform: input.platform,
        format: input.format,
        body: "Body",
        title: "Post",
        scheduledFor: null,
      }}
      busy={false}
      hasPublishedPublication={input.hasPublishedPublication}
      onApprove={noop}
      onSaveEdit={noop}
      onRegenerate={noop}
      onReject={noop}
      onSchedule={noop}
      onRecycle={noop}
    />,
  );
}

test("published Instagram post shows Recycle on review card", () => {
  const html = renderActions({
    status: "published",
    platform: "instagram",
    format: "post",
    hasPublishedPublication: true,
  });
  assert.match(html, /Recycle/);
  assert.match(html, /data-action="recycle"/);
});

test("published Facebook post shows Recycle on review card", () => {
  const html = renderActions({
    status: "published",
    platform: "facebook",
    format: "post",
    hasPublishedPublication: true,
  });
  assert.match(html, /Recycle/);
});

test("published Pinterest post shows Recycle on review card", () => {
  const html = renderActions({
    status: "published",
    platform: "pinterest",
    format: "pin",
    hasPublishedPublication: true,
  });
  assert.match(html, /Recycle/);
});

test("unpublished approved content does not show Recycle", () => {
  const html = renderActions({
    status: "approved",
    platform: "instagram",
    format: "post",
    hasPublishedPublication: false,
  });
  assert.doesNotMatch(html, /Recycle/);
});

test("website free resource does not show Recycle", () => {
  const html = renderActions({
    status: "published",
    platform: "website",
    format: "free_resource",
    hasPublishedPublication: true,
  });
  assert.doesNotMatch(html, /Recycle/);
});

test("reviewScheduleModalState opens recycle scheduling modal", () => {
  const item = {
    id: "c1",
    status: "published",
    platform: "instagram",
    format: "post",
    body: "x",
    title: "Post",
    scheduledFor: null,
  };
  const state = reviewScheduleModalState(null, item);
  assert.deepEqual(state, { mode: "recycle", item });
  const html = renderToStaticMarkup(
    <ScheduleContentModal
      mode={state!.mode}
      title="Post"
      platform="instagram"
      marketingTimezone="America/New_York"
      initialScheduledFor={null}
      busy={false}
      onClose={noop}
      onConfirm={noop}
    />,
  );
  assert.match(html, /Schedule recycled post/);
  assert.match(html, /Choose when this post should be published again/);
  assert.match(html, /Confirm recycle/);
});

test("shouldShowRecycleOnReviewCard requires published publication history", () => {
  assert.equal(
    shouldShowRecycleOnReviewCard({
      status: "published",
      platform: "instagram",
      format: "post",
      hasPublishedPublication: false,
    }),
    false,
  );
});

async function seedPublishedInstagram(store: MemoryMarketingStore) {
  process.env.MARKETING_MOCK_MODE = "true";
  await store.createAsset({
    id: "asset-1",
    name: "img",
    type: "upload",
    source: "manual_upload",
    bookId: null,
    characterId: null,
    campaignId: null,
    approved: true,
    usageRestrictions: null,
    aspectRatio: "1:1",
    imageWidth: 1080,
    imageHeight: 1080,
    mimeType: "image/png",
    tags: [],
    url: "https://cdn.example.test/post.png",
    altText: "x",
    isDemo: false,
  });
  const content: MarketingContent = {
    id: "content-1",
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "approved",
    title: "Tips",
    body: "Body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: ["asset-1"],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: null,
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.createContent(content);
  await approveContent(store, content.id, "owner");
  const past = new Date(Date.now() - 60_000).toISOString();
  const publication = await scheduleApproved(store, content.id, { scheduledFor: past });
  await publishPublication(store, publication);
  return content;
}

test("recycle API from review flow does not create duplicate marketing_content", async () => {
  const store = new MemoryMarketingStore();
  const content = await seedPublishedInstagram(store);
  assert.equal((await store.listContent()).length, 1);
  const response = await executeMarketingContentPostAction(store, {
    action: "recycle",
    contentId: content.id,
    scheduledFor: "2026-10-01T16:00:00.000Z",
    actor: "owner",
  });
  assert.equal(response.status, 200);
  assert.equal((await store.listContent()).length, 1);
  assert.equal((await store.listPublications()).length, 2);
});
