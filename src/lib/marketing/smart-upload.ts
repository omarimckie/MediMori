import { formatAspectRatioLabel, truthFromDimensions, type AssetImageTruth } from "./asset-truth";
import { catalogBooks } from "./brain";
import { getMarketingTimezone } from "./config";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import { assertImageUpload, extensionForKind, probeImageDimensions, sanitizeUploadFilename } from "./file-validation";
import {
  assertPreviewPublicUrlMatchesPathname,
  deleteMarketingBlob,
  readMarketingBlobBuffer,
  uploadPublicMarketingFile,
} from "./marketing-blob";
import {
  describeAspectRatioFailure,
  isAssetSuitableForPlatform,
} from "./platform-suitability";
import { scanMarketingText } from "./safety";
import { verifySmartUploadIntentForPathname } from "./smart-upload-intent";
import {
  isSmartUploadFinalizeKeyConflict,
  type SmartUploadFinalizeLookup,
} from "./smart-upload-idempotency";
import type { MarketingStore } from "./store";
import type {
  AudienceId,
  ContentCategory,
  MarketingAsset,
  MarketingContent,
  MarketingContentMetadata,
} from "./types";

export type SmartUploadValidationIssue = {
  code: string;
  message: string;
  platform?: "instagram" | "facebook";
};

export type SmartUploadValidationResult =
  | { ok: true; truth: AssetImageTruth; mime: string }
  | { ok: false; issues: SmartUploadValidationIssue[] };

export type SmartUploadFinalizeInput = {
  caption: string;
  batchId: string;
  finalizeKey: string;
  weeklyPlanId?: string | null;
  campaignId?: string | null;
  category?: ContentCategory;
  audience?: AudienceId;
  bookId?: string | null;
  imageFilename?: string;
  actor: string | null;
};

export type SmartUploadBlobFinalizeInput = SmartUploadFinalizeInput & {
  uploadIntent: string;
  pathname: string;
  publicUrl: string;
};

export type SmartUploadBufferFinalizeInput = SmartUploadFinalizeInput & {
  imageBuffer: Buffer;
  imageFilename: string;
};

export type SmartUploadFinalizeResult = {
  assetId: string;
  instagramContentId: string;
  facebookContentId: string;
  instagram: MarketingContent;
  facebook: MarketingContent;
  idempotentReplay: boolean;
};

export async function validateSmartUploadImageBytes(
  buffer: Buffer,
): Promise<SmartUploadValidationResult> {
  try {
    const { mime } = assertImageUpload(buffer);
    const dimensions = await probeImageDimensions(buffer);
    const truth = truthFromDimensions(dimensions.width, dimensions.height, dimensions.mimeType);
    return validateSmartUploadTruth(truth, mime);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid image.";
    return {
      ok: false,
      issues: [{ code: "invalid_image", message }],
    };
  }
}

function validateSmartUploadTruth(truth: AssetImageTruth, mime: string): SmartUploadValidationResult {
  const issues: SmartUploadValidationIssue[] = [];
  if (!isAssetSuitableForPlatform(truth, "instagram", "post")) {
    issues.push({
      code: "invalid_aspect_ratio",
      platform: "instagram",
      message: describeAspectRatioFailure("instagram", truth, "post"),
    });
  }
  if (!isAssetSuitableForPlatform(truth, "facebook", "post")) {
    issues.push({
      code: "invalid_aspect_ratio",
      platform: "facebook",
      message: describeAspectRatioFailure("facebook", truth, "post"),
    });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, truth, mime };
}

async function resolveOptionalPlanAndCampaign(
  store: MarketingStore,
  weeklyPlanId: string | null | undefined,
  campaignId: string | null | undefined,
): Promise<{ weeklyPlanId: string | null; campaignId: string | null }> {
  const resolvedWeeklyPlanId: string | null = weeklyPlanId?.trim() || null;
  let resolvedCampaignId: string | null = campaignId?.trim() || null;

  if (resolvedWeeklyPlanId) {
    const plan = await store.getWeeklyPlan(resolvedWeeklyPlanId);
    if (!plan) throw new Error("Weekly plan not found.");
    if (!resolvedCampaignId) {
      resolvedCampaignId = plan.campaignId;
    }
  }
  if (resolvedCampaignId) {
    const campaign = await store.getCampaign(resolvedCampaignId);
    if (!campaign) throw new Error("Campaign not found.");
  }
  return { weeklyPlanId: resolvedWeeklyPlanId, campaignId: resolvedCampaignId };
}

function finalizeResultFromComplete(
  lookup: Extract<SmartUploadFinalizeLookup, { status: "complete" }>,
  idempotentReplay: boolean,
): SmartUploadFinalizeResult {
  return {
    assetId: lookup.assetId,
    instagramContentId: lookup.instagram.id,
    facebookContentId: lookup.facebook.id,
    instagram: lookup.instagram,
    facebook: lookup.facebook,
    idempotentReplay,
  };
}

export async function findSmartUploadFinalizeResult(
  store: MarketingStore,
  finalizeKey: string,
): Promise<SmartUploadFinalizeResult | null> {
  const lookup = await store.findSmartUploadContentByFinalizeKey(finalizeKey);
  if (lookup.status === "complete") {
    return finalizeResultFromComplete(lookup, true);
  }
  return null;
}

type OwnedFinalizeResources = {
  contentIds: string[];
  assetCreated: boolean;
  assetId: string | null;
  blobPathname: string | null;
};

async function rollbackOwnedFinalizeAttempt(
  store: MarketingStore,
  owned: OwnedFinalizeResources,
  finalizeKey?: string,
) {
  const protectedContentIds = new Set<string>();
  let protectedAssetId: string | null = null;
  if (finalizeKey?.trim()) {
    const lookup = await store.findSmartUploadContentByFinalizeKey(finalizeKey);
    if (lookup.status === "complete") {
      protectedContentIds.add(lookup.instagram.id);
      protectedContentIds.add(lookup.facebook.id);
      protectedAssetId = lookup.assetId;
    } else if (lookup.status === "partial") {
      protectedContentIds.add(lookup.instagram.id);
      protectedAssetId = lookup.assetId;
    }
  }

  for (const contentId of owned.contentIds) {
    if (protectedContentIds.has(contentId)) continue;
    await store.deleteContent(contentId);
  }
  if (owned.assetCreated && owned.assetId && owned.assetId !== protectedAssetId) {
    await store.deleteAsset(owned.assetId);
  }
  if (owned.blobPathname) {
    await deleteMarketingBlob(owned.blobPathname);
  }
}

function assertSmartUploadAssetRecord(asset: MarketingAsset | null, assetId: string): MarketingAsset {
  if (!asset) {
    throw new Error("Smart Upload asset record is missing for an existing finalize key.");
  }
  if (asset.source !== SMART_UPLOAD_SOURCE) {
    throw new Error("Smart Upload finalize key references a non–Smart Upload asset.");
  }
  if (asset.id !== assetId) {
    throw new Error("Smart Upload asset id mismatch during finalize recovery.");
  }
  return asset;
}

type SmartUploadPersistInput = SmartUploadFinalizeInput & {
  imageBuffer: Buffer;
  imageFilename: string;
  assetUrl: string;
  /** Blob pathname to delete on rollback only when this finalize uploaded the bytes. */
  rollbackBlobPathname: string | null;
};

type SmartUploadPersistContext = {
  caption: string;
  weeklyPlanId: string | null;
  campaignId: string | null;
  truth: AssetImageTruth;
  sharedMetadata: MarketingContentMetadata;
  baseContent: Omit<
    MarketingContent,
    "id" | "platform" | "title" | "trackingToken" | "metadata" | "createdAt" | "updatedAt"
  >;
};

async function buildSmartUploadPersistContext(
  store: MarketingStore,
  input: SmartUploadPersistInput,
  validation: { truth: AssetImageTruth; mime: string },
  assetId: string,
): Promise<SmartUploadPersistContext> {
  const caption = input.caption.trim();
  const { weeklyPlanId, campaignId } = await resolveOptionalPlanAndCampaign(
    store,
    input.weeklyPlanId,
    input.campaignId,
  );
  const flags = scanMarketingText(caption);
  const warnings = ["Smart Upload — image validated for Instagram and Facebook feed."];

  const sharedMetadata: MarketingContentMetadata = {
    source: "smart_upload",
    batchId: input.batchId,
    smartUploadFinalizeKey: input.finalizeKey,
    smartUploadVersion: 1,
    placement: "feed",
    originalAssetId: assetId,
  };

  const baseContent = {
    campaignId,
    weeklyPlanId,
    format: "post" as const,
    category: input.category ?? "educational",
    audience: input.audience ?? "parents",
    status: "needs_review" as const,
    body: caption,
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: getMarketingTimezone(),
    assetIds: [assetId],
    needsNewAsset: false,
    warnings,
    safetyFlags: flags,
    originalBody: null,
    bookId: input.bookId ?? null,
    isDemo: false,
  };

  return {
    caption,
    weeklyPlanId,
    campaignId,
    truth: validation.truth,
    sharedMetadata,
    baseContent,
  };
}

async function createSmartUploadAsset(
  store: MarketingStore,
  input: SmartUploadPersistInput,
  ctx: SmartUploadPersistContext,
  assetId: string,
): Promise<MarketingAsset> {
  const truth = ctx.truth;
  return store.createAsset({
    id: assetId,
    name: sanitizeUploadFilename(input.imageFilename),
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
    bookId: input.bookId ?? null,
    characterId: null,
    campaignId: ctx.campaignId,
    approved: true,
    usageRestrictions: "Smart Upload original image (immutable).",
    aspectRatio: formatAspectRatioLabel(truth.width, truth.height),
    imageWidth: truth.width,
    imageHeight: truth.height,
    mimeType: truth.mimeType,
    tags: ["smart_upload", `batch:${input.batchId}`],
    url: input.assetUrl,
    altText: ctx.caption.slice(0, 120),
    isDemo: false,
  });
}

async function recordSmartUploadFinalizedEvent(
  store: MarketingStore,
  ctx: SmartUploadPersistContext,
  input: SmartUploadPersistInput,
  instagram: MarketingContent,
  facebook: MarketingContent,
  assetId: string,
) {
  await store.recordEvent({
    id: crypto.randomUUID(),
    name: "smart_upload_finalized",
    campaignId: ctx.campaignId,
    contentId: instagram.id,
    platform: "instagram",
    properties: {
      batchId: input.batchId,
      finalizeKey: input.finalizeKey,
      facebookContentId: facebook.id,
      assetId,
    },
  });
}

async function recoverSmartUploadAfterConflict(
  store: MarketingStore,
  input: SmartUploadPersistInput,
  validation: { truth: AssetImageTruth; mime: string },
  owned: OwnedFinalizeResources,
): Promise<SmartUploadFinalizeResult> {
  await rollbackOwnedFinalizeAttempt(store, owned, input.finalizeKey);
  const lookup = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
  if (lookup.status === "inconsistent") {
    throw new Error(lookup.reason);
  }
  if (lookup.status === "complete") {
    return finalizeResultFromComplete(lookup, true);
  }
  if (lookup.status === "partial") {
    return completePartialSmartUpload(store, input, validation, lookup, true);
  }
  throw new Error("Smart Upload finalize key conflict could not be resolved.");
}

async function completePartialSmartUpload(
  store: MarketingStore,
  input: SmartUploadPersistInput,
  validation: { truth: AssetImageTruth; mime: string },
  lookup: Extract<SmartUploadFinalizeLookup, { status: "partial" }>,
  idempotentReplay: boolean,
): Promise<SmartUploadFinalizeResult> {
  const assetId = lookup.assetId;
  const owned: OwnedFinalizeResources = {
    contentIds: [],
    assetCreated: false,
    assetId,
    blobPathname: null,
  };

  let asset = await store.getAsset(assetId);
  if (!asset) {
    const ctxForAsset = await buildSmartUploadPersistContext(store, input, validation, assetId);
    asset = await createSmartUploadAsset(store, input, ctxForAsset, assetId);
    owned.assetCreated = true;
  } else {
    assertSmartUploadAssetRecord(asset, assetId);
  }

  const ctx = await buildSmartUploadPersistContext(store, input, validation, assetId);

  try {
    const facebook = await store.createContent({
      ...ctx.baseContent,
      id: crypto.randomUUID(),
      platform: "facebook",
      title: ctx.caption.split("\n")[0]?.slice(0, 120) ?? "Facebook post",
      trackingToken: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      metadata: { ...ctx.sharedMetadata },
    });
    owned.contentIds.push(facebook.id);

    await recordSmartUploadFinalizedEvent(
      store,
      ctx,
      input,
      lookup.instagram,
      facebook,
      assetId,
    );

    return {
      assetId,
      instagramContentId: lookup.instagram.id,
      facebookContentId: facebook.id,
      instagram: lookup.instagram,
      facebook,
      idempotentReplay,
    };
  } catch (error) {
    if (isSmartUploadFinalizeKeyConflict(error)) {
      await rollbackOwnedFinalizeAttempt(store, owned, input.finalizeKey);
      const after = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
      if (after.status === "complete") {
        return finalizeResultFromComplete(after, true);
      }
    }
    await rollbackOwnedFinalizeAttempt(store, owned, input.finalizeKey);
    throw error;
  }
}

async function persistSmartUploadRecords(
  store: MarketingStore,
  input: SmartUploadPersistInput,
  validation: { truth: AssetImageTruth; mime: string },
): Promise<SmartUploadFinalizeResult> {
  const initialLookup = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
  if (initialLookup.status === "inconsistent") {
    throw new Error(initialLookup.reason);
  }
  if (initialLookup.status === "complete") {
    return finalizeResultFromComplete(initialLookup, true);
  }
  if (initialLookup.status === "partial") {
    return completePartialSmartUpload(store, input, validation, initialLookup, true);
  }

  const assetId = crypto.randomUUID();
  const ctx = await buildSmartUploadPersistContext(store, input, validation, assetId);
  const owned: OwnedFinalizeResources = {
    contentIds: [],
    assetCreated: false,
    assetId,
    blobPathname: input.rollbackBlobPathname,
  };

  try {
    const instagram = await store.createContent({
      ...ctx.baseContent,
      id: crypto.randomUUID(),
      platform: "instagram",
      title: ctx.caption.split("\n")[0]?.slice(0, 120) ?? "Instagram post",
      trackingToken: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      metadata: { ...ctx.sharedMetadata },
    });
    owned.contentIds.push(instagram.id);

    let facebook: MarketingContent;
    try {
      facebook = await store.createContent({
        ...ctx.baseContent,
        id: crypto.randomUUID(),
        platform: "facebook",
        title: ctx.caption.split("\n")[0]?.slice(0, 120) ?? "Facebook post",
        trackingToken: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
        metadata: { ...ctx.sharedMetadata },
      });
      owned.contentIds.push(facebook.id);
    } catch (error) {
      if (isSmartUploadFinalizeKeyConflict(error)) {
        return recoverSmartUploadAfterConflict(store, input, validation, owned);
      }
      throw error;
    }

    const asset = await createSmartUploadAsset(store, input, ctx, assetId);
    owned.assetCreated = true;

    await recordSmartUploadFinalizedEvent(store, ctx, input, instagram, facebook, asset.id);

    return {
      assetId: asset.id,
      instagramContentId: instagram.id,
      facebookContentId: facebook.id,
      instagram,
      facebook,
      idempotentReplay: false,
    };
  } catch (error) {
    if (isSmartUploadFinalizeKeyConflict(error)) {
      return recoverSmartUploadAfterConflict(store, input, validation, owned);
    }
    await rollbackOwnedFinalizeAttempt(store, owned, input.finalizeKey);
    throw error;
  }
}

function throwValidationFailure(validation: { ok: false; issues: SmartUploadValidationIssue[] }): never {
  const err = new Error(validation.issues.map((i) => i.message).join(" "));
  (err as Error & { validationIssues?: SmartUploadValidationIssue[] }).validationIssues =
    validation.issues;
  throw err;
}

function assertValidationOk(
  validation: SmartUploadValidationResult,
): { truth: AssetImageTruth; mime: string } {
  if (!validation.ok) throwValidationFailure(validation);
  return { truth: validation.truth, mime: validation.mime };
}

export async function validateSmartUploadStagedBlob(input: {
  uploadIntent: string;
  pathname: string;
  publicUrl: string;
  actor: string | null;
}): Promise<SmartUploadValidationResult> {
  verifySmartUploadIntentForPathname(input.uploadIntent, input.actor, input.pathname);
  assertPreviewPublicUrlMatchesPathname(input.pathname, input.publicUrl);
  const buffer = await readMarketingBlobBuffer(input.pathname, "public");
  return validateSmartUploadImageBytes(buffer);
}

export async function finalizeSmartUploadFromBuffer(
  store: MarketingStore,
  input: SmartUploadBufferFinalizeInput,
): Promise<SmartUploadFinalizeResult> {
  const existing = await findSmartUploadFinalizeResult(store, input.finalizeKey);
  if (existing) return existing;

  const validation = assertValidationOk(await validateSmartUploadImageBytes(input.imageBuffer));

  const caption = input.caption.trim();
  if (!caption) throw new Error("Caption is required.");

  if (input.bookId && !catalogBooks().some((book) => book.id === input.bookId)) {
    throw new Error("Unknown book.");
  }

  const { kind, mime } = assertImageUpload(input.imageBuffer);
  const extension = extensionForKind(kind);
  const uploaded = await uploadPublicMarketingFile(input.imageBuffer, mime, extension);

  return persistSmartUploadRecords(
    store,
    {
      ...input,
      imageBuffer: input.imageBuffer,
      imageFilename: input.imageFilename,
      assetUrl: uploaded.url,
      rollbackBlobPathname: uploaded.pathname,
    },
    validation,
  );
}

export async function finalizeSmartUploadFromBlob(
  store: MarketingStore,
  input: SmartUploadBlobFinalizeInput,
): Promise<SmartUploadFinalizeResult> {
  const existing = await findSmartUploadFinalizeResult(store, input.finalizeKey);
  if (existing) return existing;

  const validation = assertValidationOk(
    await validateSmartUploadStagedBlob({
      uploadIntent: input.uploadIntent,
      pathname: input.pathname,
      publicUrl: input.publicUrl,
      actor: input.actor,
    }),
  );

  const caption = input.caption.trim();
  if (!caption) throw new Error("Caption is required.");

  if (input.bookId && !catalogBooks().some((book) => book.id === input.bookId)) {
    throw new Error("Unknown book.");
  }

  const buffer = await readMarketingBlobBuffer(input.pathname, "public");

  return persistSmartUploadRecords(
    store,
    {
      ...input,
      imageBuffer: buffer,
      imageFilename: input.imageFilename ?? "upload.jpg",
      assetUrl: input.publicUrl.trim(),
      rollbackBlobPathname: null,
    },
    validation,
  );
}

export function allocateSmartUploadPathname(filename: string): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  const lower = filename.toLowerCase();
  let ext = ".jpg";
  if (lower.endsWith(".png")) ext = ".png";
  else if (lower.endsWith(".webp")) ext = ".webp";
  else if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) ext = ".jpg";
  return `marketing/public/${id}${ext}`;
}
