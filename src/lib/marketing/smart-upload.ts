import { formatAspectRatioLabel, truthFromDimensions, type AssetImageTruth } from "./asset-truth";
import { catalogBooks } from "./brain";
import { getMarketingTimezone } from "./config";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import { assertImageUpload, extensionForKind, probeImageDimensions, sanitizeUploadFilename } from "./file-validation";
import {
  assertPreviewPublicUrlMatchesPathname,
  deleteMarketingBlob,
  readMarketingBlobBuffer,
  tryResolveMarketingBlobPathnameFromUrl,
  uploadPrivateMarketingPublicImage,
  uploadPublicMarketingFile,
} from "./marketing-blob";
import {
  describeAspectRatioFailure,
  isAssetSuitableForPlatform,
} from "./platform-suitability";
import { scanMarketingText } from "./safety";
import {
  issueSmartUploadPreviewDerivativeIntent,
  verifySmartUploadIntentForPathname,
  verifySmartUploadPreviewDerivativeIntentForFinalize,
  verifySmartUploadPreviewDerivativeIntentForPathname,
} from "./smart-upload-intent";
import {
  isSmartUploadFinalizeKeyConflict,
  type SmartUploadFinalizeLookup,
} from "./smart-upload-idempotency";
import {
  isSmartUploadAspectRatioOnlyFailure,
  SMART_UPLOAD_DERIVATIVE_TAG,
  smartUploadOriginalTag,
  transformSmartUploadImage,
  type SmartUploadFixStrategy,
  type SmartUploadFixTargetRatio,
} from "./smart-upload-fix";
import type { SmartUploadStagedBlobRef } from "./smart-upload-api";
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

export type SmartUploadFixFinalizeBundle = {
  strategy: SmartUploadFixStrategy;
  targetRatio: SmartUploadFixTargetRatio;
  original: SmartUploadStagedBlobRef;
};

export type SmartUploadBlobFinalizeInput = SmartUploadFinalizeInput & {
  uploadIntent: string;
  pathname: string;
  publicUrl: string;
  fix?: SmartUploadFixFinalizeBundle;
};

export { isSmartUploadAspectRatioOnlyFailure } from "./smart-upload-fix";

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
  createdAssetIds: string[];
  blobPathname: string | null;
};

async function rollbackOwnedFinalizeAttempt(
  store: MarketingStore,
  owned: OwnedFinalizeResources,
  finalizeKey?: string,
) {
  const protectedContentIds = new Set<string>();
  const protectedAssetIds = new Set<string>();
  if (finalizeKey?.trim()) {
    const lookup = await store.findSmartUploadContentByFinalizeKey(finalizeKey);
    if (lookup.status === "complete") {
      protectedContentIds.add(lookup.instagram.id);
      protectedContentIds.add(lookup.facebook.id);
      protectedAssetIds.add(lookup.assetId);
      const originalId = lookup.instagram.metadata?.originalAssetId?.trim();
      if (originalId) protectedAssetIds.add(originalId);
    } else if (lookup.status === "partial") {
      protectedContentIds.add(lookup.instagram.id);
      protectedAssetIds.add(lookup.assetId);
    }
  }

  for (const contentId of owned.contentIds) {
    if (protectedContentIds.has(contentId)) continue;
    await store.deleteContent(contentId);
  }
  for (const assetId of owned.createdAssetIds) {
    if (protectedAssetIds.has(assetId)) continue;
    await store.deleteAsset(assetId);
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
    createdAssetIds: [],
    blobPathname: null,
  };

  let asset = await store.getAsset(assetId);
  if (!asset) {
    const ctxForAsset = await buildSmartUploadPersistContext(store, input, validation, assetId);
    asset = await createSmartUploadAsset(store, input, ctxForAsset, assetId);
    owned.createdAssetIds.push(assetId);
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
    createdAssetIds: [],
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
    owned.createdAssetIds.push(asset.id);

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

async function probeSmartUploadOriginalTruth(buffer: Buffer): Promise<AssetImageTruth> {
  assertImageUpload(buffer);
  const dimensions = await probeImageDimensions(buffer);
  return truthFromDimensions(dimensions.width, dimensions.height, dimensions.mimeType);
}

async function createSmartUploadOriginalAssetRecord(
  store: MarketingStore,
  input: SmartUploadPersistInput,
  ctx: {
    caption: string;
    campaignId: string | null;
    truth: AssetImageTruth;
    mime: string;
  },
  assetId: string,
  assetUrl: string,
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
    url: assetUrl,
    altText: ctx.caption.slice(0, 120),
    isDemo: false,
  });
}

async function createSmartUploadDerivativeAssetRecord(
  store: MarketingStore,
  input: SmartUploadPersistInput,
  ctx: {
    caption: string;
    campaignId: string | null;
    truth: AssetImageTruth;
    mime: string;
    strategy: SmartUploadFixStrategy;
    targetRatio: SmartUploadFixTargetRatio;
    originalAssetId: string;
  },
  assetId: string,
  assetUrl: string,
): Promise<MarketingAsset> {
  const truth = ctx.truth;
  return store.createAsset({
    id: assetId,
    name: `${sanitizeUploadFilename(input.imageFilename)} (corrected)`,
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
    bookId: input.bookId ?? null,
    characterId: null,
    campaignId: ctx.campaignId,
    approved: true,
    usageRestrictions: `Smart Upload corrected derivative (${ctx.strategy}, ${ctx.targetRatio}).`,
    aspectRatio: formatAspectRatioLabel(truth.width, truth.height),
    imageWidth: truth.width,
    imageHeight: truth.height,
    mimeType: truth.mimeType,
    tags: [
      "smart_upload",
      SMART_UPLOAD_DERIVATIVE_TAG,
      smartUploadOriginalTag(ctx.originalAssetId),
      `batch:${input.batchId}`,
    ],
    url: assetUrl,
    altText: ctx.caption.slice(0, 120),
    isDemo: false,
  });
}

async function buildFixedSmartUploadPersistContext(
  store: MarketingStore,
  input: SmartUploadPersistInput,
  derivativeValidation: { truth: AssetImageTruth; mime: string },
  derivativeAssetId: string,
  originalAssetId: string,
  fix: SmartUploadFixFinalizeBundle,
): Promise<SmartUploadPersistContext> {
  const caption = input.caption.trim();
  const { weeklyPlanId, campaignId } = await resolveOptionalPlanAndCampaign(
    store,
    input.weeklyPlanId,
    input.campaignId,
  );
  const flags = scanMarketingText(caption);
  const warnings = [
    "Smart Upload — corrected image validated for Instagram and Facebook feed.",
    `Fix: ${fix.strategy} · ${fix.targetRatio}`,
  ];

  const sharedMetadata: MarketingContentMetadata = {
    source: "smart_upload",
    batchId: input.batchId,
    smartUploadFinalizeKey: input.finalizeKey,
    smartUploadVersion: 1,
    placement: "feed",
    originalAssetId,
    smartUploadFixStrategy: fix.strategy,
    smartUploadFixTargetRatio: fix.targetRatio,
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
    assetIds: [derivativeAssetId],
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
    truth: derivativeValidation.truth,
    sharedMetadata,
    baseContent,
  };
}

export function assertDistinctSmartUploadOriginalAndDerivativePathnames(
  originalPathname: string,
  derivativePathname: string,
): void {
  if (originalPathname.trim() === derivativePathname.trim()) {
    throw new Error("Original and derivative pathnames must differ for fixed Smart Upload finalize.");
  }
}

async function persistFixedSmartUploadRecords(
  store: MarketingStore,
  input: SmartUploadPersistInput,
  originalTruth: AssetImageTruth,
  originalMime: string,
  derivativeValidation: { truth: AssetImageTruth; mime: string },
  fix: SmartUploadFixFinalizeBundle,
  originalAssetUrl: string,
  derivativeAssetUrl: string,
): Promise<SmartUploadFinalizeResult> {
  const initialLookup = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
  if (initialLookup.status === "inconsistent") {
    throw new Error(initialLookup.reason);
  }
  if (initialLookup.status === "complete") {
    return finalizeResultFromComplete(initialLookup, true);
  }
  if (initialLookup.status === "partial") {
    throw new Error(
      "Smart Upload finalize key is in a partial state; fixed finalize cannot complete it safely.",
    );
  }

  const originalAssetId = crypto.randomUUID();
  const derivativeAssetId = crypto.randomUUID();
  const ctx = await buildFixedSmartUploadPersistContext(
    store,
    input,
    derivativeValidation,
    derivativeAssetId,
    originalAssetId,
    fix,
  );

  const owned: OwnedFinalizeResources = {
    contentIds: [],
    createdAssetIds: [],
    blobPathname: null,
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
        return recoverSmartUploadAfterConflict(store, input, derivativeValidation, owned);
      }
      throw error;
    }

    const originalAsset = await createSmartUploadOriginalAssetRecord(
      store,
      input,
      { caption: ctx.caption, campaignId: ctx.campaignId, truth: originalTruth, mime: originalMime },
      originalAssetId,
      originalAssetUrl,
    );
    owned.createdAssetIds.push(originalAsset.id);

    const derivativeAsset = await createSmartUploadDerivativeAssetRecord(
      store,
      input,
      {
        caption: ctx.caption,
        campaignId: ctx.campaignId,
        truth: derivativeValidation.truth,
        mime: derivativeValidation.mime,
        strategy: fix.strategy,
        targetRatio: fix.targetRatio,
        originalAssetId,
      },
      derivativeAssetId,
      derivativeAssetUrl,
    );
    owned.createdAssetIds.push(derivativeAsset.id);

    await recordSmartUploadFinalizedEvent(
      store,
      ctx,
      input,
      instagram,
      facebook,
      derivativeAsset.id,
    );

    return {
      assetId: derivativeAsset.id,
      instagramContentId: instagram.id,
      facebookContentId: facebook.id,
      instagram,
      facebook,
      idempotentReplay: false,
    };
  } catch (error) {
    if (isSmartUploadFinalizeKeyConflict(error)) {
      return recoverSmartUploadAfterConflict(store, input, derivativeValidation, owned);
    }
    await rollbackOwnedFinalizeAttempt(store, owned, input.finalizeKey);
    throw error;
  }
}

export async function finalizeSmartUploadFixedFromStagedBlobs(
  store: MarketingStore,
  input: SmartUploadBlobFinalizeInput,
): Promise<SmartUploadFinalizeResult> {
  if (!input.fix) {
    throw new Error("Fixed finalize requires a fix bundle.");
  }

  assertDistinctSmartUploadOriginalAndDerivativePathnames(
    input.fix.original.pathname,
    input.pathname,
  );

  verifySmartUploadIntentForPathname(
    input.fix.original.uploadIntent,
    input.actor,
    input.fix.original.pathname,
  );
  assertPreviewPublicUrlMatchesPathname(
    input.fix.original.pathname,
    input.fix.original.publicUrl,
  );

  verifySmartUploadPreviewDerivativeIntentForFinalize(
    input.uploadIntent,
    input.actor,
    {
      derivativePathname: input.pathname,
      originalPathname: input.fix.original.pathname,
      finalizeKey: input.finalizeKey,
      strategy: input.fix.strategy,
      targetRatio: input.fix.targetRatio,
    },
  );
  assertPreviewPublicUrlMatchesPathname(input.pathname, input.publicUrl);

  const originalBuffer = await readMarketingBlobBuffer(input.fix.original.pathname, "public");
  const originalMime = assertImageUpload(originalBuffer).mime;
  const originalTruth = await probeSmartUploadOriginalTruth(originalBuffer);

  const derivativeBuffer = await readMarketingBlobBuffer(input.pathname, "public");
  const derivativeValidation = assertValidationOk(
    await validateSmartUploadImageBytes(derivativeBuffer),
  );

  return persistFixedSmartUploadRecords(
    store,
    {
      ...input,
      imageBuffer: await readMarketingBlobBuffer(input.pathname, "public"),
      imageFilename: input.imageFilename ?? "upload.jpg",
      assetUrl: input.publicUrl.trim(),
      rollbackBlobPathname: null,
    },
    originalTruth,
    originalMime,
    derivativeValidation,
    input.fix,
    input.fix.original.publicUrl.trim(),
    input.publicUrl.trim(),
  );
}

/** Test helper: finalize fixed upload from in-memory buffers (no blob I/O). */
export async function finalizeSmartUploadFixedFromBuffers(
  store: MarketingStore,
  input: SmartUploadFinalizeInput & {
    fix: SmartUploadFixFinalizeBundle;
    originalBuffer: Buffer;
    derivativeBuffer: Buffer;
    originalAssetUrl: string;
    derivativeAssetUrl: string;
    imageFilename?: string;
  },
): Promise<SmartUploadFinalizeResult> {
  const existing = await findSmartUploadFinalizeResult(store, input.finalizeKey);
  if (existing) return existing;

  const derivativePathname =
    tryResolveMarketingBlobPathnameFromUrl(input.derivativeAssetUrl) ?? "";
  assertDistinctSmartUploadOriginalAndDerivativePathnames(
    input.fix.original.pathname,
    derivativePathname,
  );

  const caption = input.caption.trim();
  if (!caption) throw new Error("Caption is required.");

  const originalMime = assertImageUpload(input.originalBuffer).mime;
  const originalTruth = await probeSmartUploadOriginalTruth(input.originalBuffer);
  const derivativeValidation = assertValidationOk(
    await validateSmartUploadImageBytes(input.derivativeBuffer),
  );

  return persistFixedSmartUploadRecords(
    store,
    {
      ...input,
      imageBuffer: input.derivativeBuffer,
      imageFilename: input.imageFilename ?? "upload.jpg",
      assetUrl: input.derivativeAssetUrl,
      rollbackBlobPathname: null,
    },
    originalTruth,
    originalMime,
    derivativeValidation,
    input.fix,
    input.originalAssetUrl,
    input.derivativeAssetUrl,
  );
}

export async function generateSmartUploadPreviewFix(input: {
  actor: string | null;
  finalizeKey: string;
  original: SmartUploadStagedBlobRef;
  strategy: SmartUploadFixStrategy;
  targetRatio: SmartUploadFixTargetRatio;
  imageFilename?: string;
}): Promise<{
  uploadIntent: string;
  pathname: string;
  publicUrl: string;
  strategy: SmartUploadFixStrategy;
  targetRatio: SmartUploadFixTargetRatio;
  width: number;
  height: number;
  mime: string;
}> {
  verifySmartUploadIntentForPathname(
    input.original.uploadIntent,
    input.actor,
    input.original.pathname,
  );
  assertPreviewPublicUrlMatchesPathname(input.original.pathname, input.original.publicUrl);
  const originalBuffer = await readMarketingBlobBuffer(input.original.pathname, "public");
  const validation = await validateSmartUploadImageBytes(originalBuffer);
  if (validation.ok) {
    throw new Error("Image already passes Smart Upload validation; fix is not required.");
  }
  if (!isSmartUploadAspectRatioOnlyFailure(validation.issues)) {
    throw new Error("Only invalid aspect ratio images can be fixed in Smart Upload Phase 3.");
  }

  const transformed = await transformSmartUploadImage({
    buffer: originalBuffer,
    strategy: input.strategy,
    targetRatio: input.targetRatio,
  });

  const { kind } = assertImageUpload(transformed.buffer);
  const extension = extensionForKind(kind);
  const uploaded = await uploadPrivateMarketingPublicImage(
    transformed.buffer,
    transformed.mime,
    extension,
    input.original.publicUrl,
  );
  assertDistinctSmartUploadOriginalAndDerivativePathnames(
    input.original.pathname,
    uploaded.pathname,
  );
  const { uploadIntent } = issueSmartUploadPreviewDerivativeIntent({
    username: input.actor ?? "",
    pathname: uploaded.pathname,
    originalPathname: input.original.pathname,
    finalizeKey: input.finalizeKey,
    strategy: input.strategy,
    targetRatio: input.targetRatio,
  });

  return {
    uploadIntent,
    pathname: uploaded.pathname,
    publicUrl: uploaded.url,
    strategy: input.strategy,
    targetRatio: input.targetRatio,
    width: transformed.truth.width,
    height: transformed.truth.height,
    mime: transformed.mime,
  };
}

export async function discardSmartUploadPreviewDerivative(input: {
  actor: string | null;
  preview: SmartUploadStagedBlobRef;
}): Promise<void> {
  verifySmartUploadPreviewDerivativeIntentForPathname(
    input.preview.uploadIntent,
    input.actor,
    input.preview.pathname,
  );
  assertPreviewPublicUrlMatchesPathname(input.preview.pathname, input.preview.publicUrl);
  await deleteMarketingBlob(input.preview.pathname);
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

  const caption = input.caption.trim();
  if (!caption) throw new Error("Caption is required.");

  if (input.bookId && !catalogBooks().some((book) => book.id === input.bookId)) {
    throw new Error("Unknown book.");
  }

  if (input.fix) {
    return finalizeSmartUploadFixedFromStagedBlobs(store, input);
  }

  const validation = assertValidationOk(
    await validateSmartUploadStagedBlob({
      uploadIntent: input.uploadIntent,
      pathname: input.pathname,
      publicUrl: input.publicUrl,
      actor: input.actor,
    }),
  );

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
