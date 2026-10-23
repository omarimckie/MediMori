import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { approveContent } from "./approval";
import { executeMarketingContentPostAction } from "./content-post-action";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import { MemoryMarketingStore } from "./memory-store";
import {
  assertMarketingPreviewAllowsMutations,
  isMarketingPreviewReadonly,
  isMarketingPreviewReadonlyMutationRequest,
  MarketingPreviewReadonlyError,
  MARKETING_PREVIEW_READONLY_MESSAGE,
} from "./preview-readonly";
import { handleMarketingPublishCron } from "./reliability/marketing-publish-cron";
import {
  deleteMarketingBlob,
  uploadPublicMarketingFile,
} from "./marketing-blob";
import { runApprovalAction } from "./workflow";
import { updateMarketingAssetMetadata } from "./asset-update";

const ORIGINAL_ENV = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  MARKETING_PREVIEW_READONLY: process.env.MARKETING_PREVIEW_READONLY,
};

afterEach(() => {
  if (ORIGINAL_ENV.VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = ORIGINAL_ENV.VERCEL_ENV;
  if (ORIGINAL_ENV.MARKETING_PREVIEW_READONLY === undefined) {
    delete process.env.MARKETING_PREVIEW_READONLY;
  } else {
    process.env.MARKETING_PREVIEW_READONLY = ORIGINAL_ENV.MARKETING_PREVIEW_READONLY;
  }
});

test("preview readonly defaults off without env", () => {
  assert.equal(isMarketingPreviewReadonly({}), false);
  assert.equal(
    isMarketingPreviewReadonly({ MARKETING_PREVIEW_READONLY: "1" }),
    false,
  );
  assert.equal(
    isMarketingPreviewReadonly({ VERCEL_ENV: "production", MARKETING_PREVIEW_READONLY: "1" }),
    false,
  );
  assert.equal(
    isMarketingPreviewReadonly({ VERCEL_ENV: "preview", MARKETING_PREVIEW_READONLY: "0" }),
    false,
  );
});

test("preview readonly enables only for Vercel Preview with explicit flag", () => {
  assert.equal(
    isMarketingPreviewReadonly({ VERCEL_ENV: "preview", MARKETING_PREVIEW_READONLY: "1" }),
    true,
  );
  assert.equal(
    isMarketingPreviewReadonly({ VERCEL_ENV: "preview", MARKETING_PREVIEW_READONLY: "true" }),
    true,
  );
});

test("client-style signals cannot enable readonly (query/header keys ignored)", () => {
  assert.equal(
    isMarketingPreviewReadonly({
      VERCEL_ENV: "preview",
      // spoofed client-shaped keys must not enable the guard
      "x-marketing-preview-readonly": "1",
      marketingPreviewReadonly: "1",
      READONLY: "1",
    }),
    false,
  );
});

test("mutation path matrix blocks marketing writes and cron triggers", () => {
  const blocked: Array<[string, string]> = [
    ["/api/admin/marketing/content/abc", "POST"],
    ["/api/admin/marketing/content/assign-week", "POST"],
    ["/api/admin/marketing/content/smart-upload-pair", "POST"],
    ["/api/admin/marketing/assets/abc", "PATCH"],
    ["/api/admin/marketing/assets/abc", "POST"],
    ["/api/admin/marketing/campaigns", "POST"],
    ["/api/admin/marketing/campaigns/abc", "POST"],
    ["/api/admin/marketing/manual/post", "POST"],
    ["/api/admin/marketing/manual/resource", "POST"],
    ["/api/admin/marketing/manual/resource/blob", "POST"],
    ["/api/admin/marketing/manual/resource/cleanup", "POST"],
    ["/api/admin/marketing/manual/resource/upload-intent", "POST"],
    ["/api/admin/marketing/manual/resource/upload-url", "POST"],
    ["/api/admin/marketing/notifications", "POST"],
    ["/api/admin/marketing/notifications/abc/read", "POST"],
    ["/api/admin/marketing/notifications/preferences", "PUT"],
    ["/api/admin/marketing/notifications/push/subscribe", "POST"],
    ["/api/admin/marketing/notifications/push/test", "POST"],
    ["/api/admin/marketing/notifications/push/unsubscribe", "POST"],
    ["/api/admin/marketing/plans", "POST"],
    ["/api/admin/marketing/publications/abc/retry", "POST"],
    ["/api/admin/marketing/recommendations", "POST"],
    ["/api/admin/marketing/seed", "POST"],
    ["/api/admin/marketing/settings", "POST"],
    ["/api/admin/marketing/preview-db-identity", "POST"],
    ["/api/admin/marketing/smart-upload/blob", "POST"],
    ["/api/admin/marketing/smart-upload/discard-preview", "POST"],
    ["/api/admin/marketing/smart-upload/finalize", "POST"],
    ["/api/admin/marketing/smart-upload/generate-captions", "POST"],
    ["/api/admin/marketing/smart-upload/preview-form", "POST"],
    ["/api/admin/marketing/smart-upload/upload-intent", "POST"],
    ["/api/admin/marketing/smart-upload/upload-url", "POST"],
    ["/api/admin/marketing/smart-upload/validate", "POST"],
    ["/api/admin/marketing/week", "POST"],
    ["/api/admin/marketing/incidents/abc/resolve", "POST"],
    ["/api/admin/marketing/incidents/abc/transition", "POST"],
    ["/api/cron/marketing-publish", "POST"],
    ["/api/cron/marketing-publish", "GET"],
    ["/api/cron/marketing-reliability", "POST"],
    ["/api/cron/marketing-reliability", "GET"],
  ];
  for (const [path, method] of blocked) {
    assert.equal(
      isMarketingPreviewReadonlyMutationRequest(path, method),
      true,
      `${method} ${path}`,
    );
  }
});

test("read paths remain unblocked by path classifier", () => {
  assert.equal(
    isMarketingPreviewReadonlyMutationRequest(
      "/api/admin/marketing/content?enrich=preview&status=needs_review",
      "GET",
    ),
    false,
  );
  assert.equal(
    isMarketingPreviewReadonlyMutationRequest("/api/admin/marketing/settings", "GET"),
    false,
  );
  assert.equal(
    isMarketingPreviewReadonlyMutationRequest("/api/admin/marketing/preview-db-identity", "GET"),
    false,
  );
  assert.equal(
    isMarketingPreviewReadonlyMutationRequest("/api/admin/marketing/preview-db-identity", "POST"),
    true,
  );
  assert.equal(
    isMarketingPreviewReadonlyMutationRequest(
      "/api/admin/marketing/assets/a87843a4-2f77-4626-880d-ddda9445ab09/image",
      "GET",
    ),
    false,
  );
  assert.equal(
    isMarketingPreviewReadonlyMutationRequest(
      "/api/admin/marketing/assets/a87843a4-2f77-4626-880d-ddda9445ab09/image",
      "HEAD",
    ),
    false,
  );
  assert.equal(isMarketingPreviewReadonlyMutationRequest("/api/admin/login", "POST"), false);
  assert.equal(isMarketingPreviewReadonlyMutationRequest("/api/admin/logout", "POST"), false);
});

test("content approve is rejected in readonly mode without store writes", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.MARKETING_PREVIEW_READONLY = "1";

  const store = new MemoryMarketingStore();
  const contentId = crypto.randomUUID();
  await store.createContent({
    id: contentId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "facebook",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "t",
    body: "body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok-ro",
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: true,
  });

  const response = await executeMarketingContentPostAction(store, {
    action: "approve",
    contentId,
    actor: "preview-admin",
  });
  assert.equal(response.status, 403);
  const json = (await response.json()) as { error?: string };
  assert.equal(json.error, MARKETING_PREVIEW_READONLY_MESSAGE);

  const content = await store.getContent(contentId);
  assert.equal(content?.status, "needs_review");
  assert.equal((await store.listApprovals(contentId)).length, 0);
  assert.equal((await store.listPublications()).length, 0);
});

test("content approve still works when readonly is disabled", async () => {
  process.env.VERCEL_ENV = "preview";
  delete process.env.MARKETING_PREVIEW_READONLY;

  const store = new MemoryMarketingStore();
  const contentId = crypto.randomUUID();
  await store.createContent({
    id: contentId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "instagram",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "t",
    body: "body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok-ok",
    originalBody: null,
    bookId: null,
    metadata: { source: SMART_UPLOAD_SOURCE },
    isDemo: true,
  });

  const updated = await approveContent(store, contentId, "owner");
  assert.equal(updated?.status, "approved");
});

test("blob upload and delete cannot execute in readonly mode", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.MARKETING_PREVIEW_READONLY = "1";

  await assert.rejects(
    () => uploadPublicMarketingFile(Buffer.from("x"), "image/png", ".png"),
    (error: unknown) => error instanceof MarketingPreviewReadonlyError,
  );
  await assert.rejects(
    () => deleteMarketingBlob("marketing/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png"),
    (error: unknown) => error instanceof MarketingPreviewReadonlyError,
  );
});

test("publish cron cannot execute in readonly mode even when authorize would pass", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.MARKETING_PREVIEW_READONLY = "1";

  let publishCalled = false;
  const outcome = await handleMarketingPublishCron(new Request("https://example.test"), {
    authorize: async () => ({ ok: true, reason: "admin_session" }),
    getStore: () => {
      throw new Error("store should not be reached");
    },
    publishDue: async () => {
      publishCalled = true;
      return [];
    },
    recordHeartbeat: async () => {
      throw new Error("heartbeat should not be reached");
    },
    runReliabilityAfterMarketingPublish: async () => null,
  });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.status, 403);
    assert.equal(outcome.body.error, MARKETING_PREVIEW_READONLY_MESSAGE);
  }
  assert.equal(publishCalled, false);
});

test("assert helper throws only when readonly active", () => {
  assert.doesNotThrow(() => assertMarketingPreviewAllowsMutations({ VERCEL_ENV: "preview" }));
  assert.throws(
    () =>
      assertMarketingPreviewAllowsMutations({
        VERCEL_ENV: "preview",
        MARKETING_PREVIEW_READONLY: "1",
      }),
    MarketingPreviewReadonlyError,
  );
});

test("runApprovalAction and asset metadata updates reject before side effects", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.MARKETING_PREVIEW_READONLY = "1";

  const store = new MemoryMarketingStore();
  const contentId = crypto.randomUUID();
  await store.createContent({
    id: contentId,
    campaignId: null,
    weeklyPlanId: null,
    platform: "facebook",
    format: "post",
    category: "educational",
    audience: "parents",
    status: "needs_review",
    title: "t",
    body: "body",
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: "America/New_York",
    assetIds: [],
    needsNewAsset: false,
    warnings: [],
    safetyFlags: [],
    trackingToken: "tok-workflow-ro",
    originalBody: null,
    bookId: null,
    metadata: {},
    isDemo: true,
  });

  await assert.rejects(
    () => runApprovalAction(store, { action: "approve", contentId, actor: "preview-admin" }),
    (error: unknown) => error instanceof MarketingPreviewReadonlyError,
  );
  assert.equal((await store.getContent(contentId))?.status, "needs_review");

  await assert.rejects(
    () => updateMarketingAssetMetadata(store, crypto.randomUUID(), { name: "nope" }),
    (error: unknown) => error instanceof MarketingPreviewReadonlyError,
  );
});

test("production stays writable even if MARKETING_PREVIEW_READONLY is mis-set", () => {
  assert.equal(
    isMarketingPreviewReadonly({
      VERCEL_ENV: "production",
      MARKETING_PREVIEW_READONLY: "true",
    }),
    false,
  );
  assert.doesNotThrow(() =>
    assertMarketingPreviewAllowsMutations({
      VERCEL_ENV: "production",
      MARKETING_PREVIEW_READONLY: "1",
    }),
  );
  assert.equal(
    isMarketingPreviewReadonlyMutationRequest("/api/admin/marketing/content/x", "POST"),
    true,
  );
  // classifier still marks POST as a mutation path, but Production never enables the gate
  assert.equal(
    isMarketingPreviewReadonly({ VERCEL_ENV: "production", MARKETING_PREVIEW_READONLY: "1" }) &&
      isMarketingPreviewReadonlyMutationRequest("/api/admin/marketing/content/x", "POST"),
    false,
  );
});
