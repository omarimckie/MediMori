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
import { observeSmartUploadFinalizeFailure } from "./smart-upload-incidents/observe";
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

export type { SmartUploadValidationIssue } from "./smart-upload-destinations";
import {
  assertAtLeastOneDestination,
  collectSmartUploadValidationIssues,
  metaImagePassesValidation,
  pinterestImagePassesValidation,
  normalizeSmartUploadDestinations,
  SMART_UPLOAD_DESTINATIONS_META_ONLY,
  metaDestinationsSelected,
  type SmartUploadDestinations,
  type SmartUploadValidationIssue,
} from "./smart-upload-destinations";
import {
  finalizeResultFromLookup,
  persistSmartUploadMultiPlatform,
  resolveSmartUploadFinalizeCaptions,
  resolveSmartUploadPinterestCopy,
  type SmartUploadImageOutputs,
} from "./smart-upload-finalize";

export type SmartUploadValidationResult =
  | { ok: true; truth: AssetImageTruth; mime: string }
  | { ok: false; issues: SmartUploadValidationIssue[] };

export type SmartUploadPlatformCaptions = {
  facebook: string;
  instagram: string;
};

export type SmartUploadFinalizeInput = {
  caption: string;
  /** When set, Facebook and Instagram content bodies use these strings instead of `caption`. */
  platformCaptions?: SmartUploadPlatformCaptions;
  destinations?: SmartUploadDestinations;
  pinterestTitle?: string | null;
  pinterestDescription?: string | null;
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

export type SmartUploadStagedOutputRef = SmartUploadStagedBlobRef & {
  fix?: SmartUploadFixFinalizeBundle;
};

export type SmartUploadBlobFinalizeInput = SmartUploadFinalizeInput & {
  uploadIntent: string;
  pathname: string;
  publicUrl: string;
  fix?: SmartUploadFixFinalizeBundle;
  /** When Pinterest needs a separate derivative from the original upload. */
  pinterestOutput?: SmartUploadStagedOutputRef;
};

export { isSmartUploadAspectRatioOnlyFailure } from "./smart-upload-fix";

export type SmartUploadBufferFinalizeInput = SmartUploadFinalizeInput & {
  imageBuffer: Buffer;
  imageFilename: string;
};

export type SmartUploadFinalizeResult = {
  assetId: string;
  destinations: SmartUploadDestinations;
  instagramContentId: string | null;
  facebookContentId: string | null;
  pinterestContentId: string | null;
  instagram: MarketingContent | null;
  facebook: MarketingContent | null;
  pinterest: MarketingContent | null;
  idempotentReplay: boolean;
};

export { resolveSmartUploadFinalizeCaptions } from "./smart-upload-finalize";

export async function validateSmartUploadImageBytes(
  buffer: Buffer,
  destinations: SmartUploadDestinations = SMART_UPLOAD_DESTINATIONS_META_ONLY,
): Promise<SmartUploadValidationResult> {
  try {
    const { mime } = assertImageUpload(buffer);
    const dimensions = await probeImageDimensions(buffer);
    const truth = truthFromDimensions(dimensions.width, dimensions.height, dimensions.mimeType);
    return validateSmartUploadTruth(truth, mime, destinations);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid image.";
    return {
      ok: false,
      issues: [{ code: "invalid_image", message }],
    };
  }
}

function validateSmartUploadTruth(
  truth: AssetImageTruth,
  mime: string,
  destinations: SmartUploadDestinations,
): SmartUploadValidationResult {
  const issues = collectSmartUploadValidationIssues(truth, destinations);
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

export async function findSmartUploadFinalizeResult(
  store: MarketingStore,
  finalizeKey: string,
): Promise<SmartUploadFinalizeResult | null> {
  const lookup = await store.findSmartUploadContentByFinalizeKey(finalizeKey);
  if (lookup.status === "complete") {
    return finalizeResultFromLookup(lookup, true);
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
    if (lookup.status === "complete" || lookup.status === "partial") {
      for (const row of [lookup.instagram, lookup.facebook, lookup.pinterest]) {
        if (row) protectedContentIds.add(row.id);
      }
      protectedAssetIds.add(lookup.assetId);
      const originalId =
        lookup.instagram?.metadata?.originalAssetId?.trim() ??
        lookup.facebook?.metadata?.originalAssetId?.trim() ??
        lookup.pinterest?.metadata?.originalAssetId?.trim();
      if (originalId) protectedAssetIds.add(originalId);
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
  facebookBody: string;
  instagramBody: string;
  weeklyPlanId: string | null;
  campaignId: string | null;
  truth: AssetImageTruth;
  sharedMetadata: MarketingContentMetadata;
  baseContent: Omit<
    MarketingContent,
    "id" | "platform" | "title" | "trackingToken" | "metadata" | "createdAt" | "updatedAt" | "body"
  >;
};

async function buildSmartUploadPersistContext(
  store: MarketingStore,
  input: SmartUploadPersistInput,
  validation: { truth: AssetImageTruth; mime: string },
  assetId: string,
): Promise<SmartUploadPersistContext> {
  const destinations = normalizeSmartUploadDestinations(input.destinations);
  const resolved = resolveSmartUploadFinalizeCaptions(input, destinations);
  const { weeklyPlanId, campaignId } = await resolveOptionalPlanAndCampaign(
    store,
    input.weeklyPlanId,
    input.campaignId,
  );
  const flags = scanMarketingText(`${resolved.instagram}\n${resolved.facebook}`);
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
    caption: resolved.primaryForAssetAlt,
    facebookBody: resolved.facebook,
    instagramBody: resolved.instagram,
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
    return finalizeResultFromLookup(lookup, true);
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
  if (!lookup.instagram) {
    throw new Error("Partial Smart Upload finalize is missing an Instagram row.");
  }
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
      body: ctx.facebookBody,
      title: ctx.facebookBody.split("\n")[0]?.slice(0, 120) ?? "Facebook post",
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

    const after = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
    if (after.status !== "complete") {
      throw new Error("Smart Upload partial recovery did not reach a complete state.");
    }
    return finalizeResultFromLookup(after, idempotentReplay);
  } catch (error) {
    if (isSmartUploadFinalizeKeyConflict(error)) {
      await rollbackOwnedFinalizeAttempt(store, owned, input.finalizeKey);
      const after = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
      if (after.status === "complete") {
        return finalizeResultFromLookup(after, true);
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
    return finalizeResultFromLookup(initialLookup, true);
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
      body: ctx.instagramBody,
      title: ctx.instagramBody.split("\n")[0]?.slice(0, 120) ?? "Instagram post",
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
        body: ctx.facebookBody,
        title: ctx.facebookBody.split("\n")[0]?.slice(0, 120) ?? "Facebook post",
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

    const after = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
    if (after.status !== "complete") {
      throw new Error("Smart Upload finalize did not reach a complete state.");
    }
    return finalizeResultFromLookup(after, false);
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
  destinations?: SmartUploadDestinations;
}): Promise<SmartUploadValidationResult> {
  verifySmartUploadIntentForPathname(input.uploadIntent, input.actor, input.pathname);
  assertPreviewPublicUrlMatchesPathname(input.pathname, input.publicUrl);
  const buffer = await readMarketingBlobBuffer(input.pathname, "public");
  return validateSmartUploadImageBytes(
    buffer,
    normalizeSmartUploadDestinations(input.destinations),
  );
}

async function readStagedBlobTruth(
  ref: SmartUploadStagedBlobRef,
  actor: string | null,
): Promise<{ truth: AssetImageTruth; mime: string; buffer: Buffer }> {
  verifySmartUploadIntentForPathname(ref.uploadIntent, actor, ref.pathname);
  assertPreviewPublicUrlMatchesPathname(ref.pathname, ref.publicUrl);
  const buffer = await readMarketingBlobBuffer(ref.pathname, "public");
  const { mime } = assertImageUpload(buffer);
  const truth = await probeSmartUploadOriginalTruth(buffer);
  return { truth, mime, buffer };
}

async function validatedBlobTruth(
  ref: SmartUploadStagedBlobRef,
  actor: string | null,
  destinations: SmartUploadDestinations,
): Promise<{ truth: AssetImageTruth; mime: string; buffer: Buffer }> {
  verifySmartUploadIntentForPathname(ref.uploadIntent, actor, ref.pathname);
  assertPreviewPublicUrlMatchesPathname(ref.pathname, ref.publicUrl);
  const buffer = await readMarketingBlobBuffer(ref.pathname, "public");
  const validation = assertValidationOk(await validateSmartUploadImageBytes(buffer, destinations));
  return { ...validation, buffer };
}

async function assembleBlobFinalizeOutputs(
  input: SmartUploadBlobFinalizeInput,
  destinations: SmartUploadDestinations,
): Promise<SmartUploadImageOutputs> {
  const originalRef: SmartUploadStagedBlobRef = input.fix?.original ?? {
    uploadIntent: input.uploadIntent,
    pathname: input.pathname,
    publicUrl: input.publicUrl,
  };

  const original = await readStagedBlobTruth(originalRef, input.actor);
  const originalAssetId = crypto.randomUUID();
  const outputs: SmartUploadImageOutputs = {
    original: {
      assetId: originalAssetId,
      url: originalRef.publicUrl.trim(),
      truth: original.truth,
      mime: original.mime,
    },
  };

  if (metaDestinationsSelected(destinations)) {
    if (input.fix) {
      verifySmartUploadPreviewDerivativeIntentForFinalize(input.uploadIntent, input.actor, {
        derivativePathname: input.pathname,
        originalPathname: input.fix.original.pathname,
        finalizeKey: input.finalizeKey,
        strategy: input.fix.strategy,
        targetRatio: input.fix.targetRatio,
      });
      assertPreviewPublicUrlMatchesPathname(input.pathname, input.publicUrl);
      const metaBuffer = await readMarketingBlobBuffer(input.pathname, "public");
      const metaValidation = assertValidationOk(
        await validateSmartUploadImageBytes(metaBuffer, { ...destinations, pinterest: false }),
      );
      outputs.meta = {
        assetId: crypto.randomUUID(),
        url: input.publicUrl.trim(),
        truth: metaValidation.truth,
        mime: metaValidation.mime,
        fix: input.fix,
      };
    } else if (!metaImagePassesValidation(original.truth, destinations)) {
      throwValidationFailure({
        ok: false,
        issues: collectSmartUploadValidationIssues(original.truth, destinations).filter(
          (issue) => issue.platform !== "pinterest",
        ),
      });
    }
  }

  if (destinations.pinterest) {
    if (input.pinterestOutput) {
      const pinRef = input.pinterestOutput;
      if (pinRef.fix) {
        verifySmartUploadPreviewDerivativeIntentForFinalize(pinRef.uploadIntent, input.actor, {
          derivativePathname: pinRef.pathname,
          originalPathname: pinRef.fix.original.pathname,
          finalizeKey: input.finalizeKey,
          strategy: pinRef.fix.strategy,
          targetRatio: pinRef.fix.targetRatio,
        });
      } else {
        verifySmartUploadIntentForPathname(pinRef.uploadIntent, input.actor, pinRef.pathname);
      }
      assertPreviewPublicUrlMatchesPathname(pinRef.pathname, pinRef.publicUrl);
      const pinBuffer = await readMarketingBlobBuffer(pinRef.pathname, "public");
      const pinValidation = assertValidationOk(
        await validateSmartUploadImageBytes(pinBuffer, {
          facebook: false,
          instagram: false,
          pinterest: true,
        }),
      );
      outputs.pinterest = {
        assetId: crypto.randomUUID(),
        url: pinRef.publicUrl.trim(),
        truth: pinValidation.truth,
        mime: pinValidation.mime,
        fix: pinRef.fix,
      };
    } else if (!pinterestImagePassesValidation(original.truth, destinations)) {
      throwValidationFailure({
        ok: false,
        issues: collectSmartUploadValidationIssues(original.truth, {
          facebook: false,
          instagram: false,
          pinterest: true,
        }),
      });
    }
  }

  return outputs;
}

async function runSmartUploadFinalize(
  store: MarketingStore,
  input: SmartUploadFinalizeInput & {
    outputs: SmartUploadImageOutputs;
    rollbackBlobPathname: string | null;
  },
): Promise<SmartUploadFinalizeResult> {
  const destinations = normalizeSmartUploadDestinations(input.destinations);
  assertAtLeastOneDestination(destinations);
  if (metaDestinationsSelected(destinations)) {
    resolveSmartUploadFinalizeCaptions(input, destinations);
  }
  const pinterestCopy = resolveSmartUploadPinterestCopy({
    destinations,
    pinterestTitle: input.pinterestTitle,
    pinterestDescription: input.pinterestDescription,
  });
  const { weeklyPlanId, campaignId } = await resolveOptionalPlanAndCampaign(
    store,
    input.weeklyPlanId,
    input.campaignId,
  );
  return persistSmartUploadMultiPlatform(store, {
    ...input,
    destinations,
    pinterestCopy,
    weeklyPlanId,
    campaignId,
    outputs: input.outputs,
    rollbackBlobPathname: input.rollbackBlobPathname,
  });
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
  const destinations = normalizeSmartUploadDestinations(input.destinations);
  const resolved = resolveSmartUploadFinalizeCaptions(input, destinations);
  const { weeklyPlanId, campaignId } = await resolveOptionalPlanAndCampaign(
    store,
    input.weeklyPlanId,
    input.campaignId,
  );
  const flags = scanMarketingText(`${resolved.instagram}\n${resolved.facebook}`);
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
    caption: resolved.primaryForAssetAlt,
    facebookBody: resolved.facebook,
    instagramBody: resolved.instagram,
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
    return finalizeResultFromLookup(initialLookup, true);
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
      body: ctx.instagramBody,
      title: ctx.instagramBody.split("\n")[0]?.slice(0, 120) ?? "Instagram post",
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
        body: ctx.facebookBody,
        title: ctx.facebookBody.split("\n")[0]?.slice(0, 120) ?? "Facebook post",
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

    const after = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
    if (after.status !== "complete") {
      throw new Error("Smart Upload fixed finalize did not reach a complete state.");
    }
    return finalizeResultFromLookup(after, false);
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

  const destinations = normalizeSmartUploadDestinations(input.destinations);
  const originalMime = assertImageUpload(input.originalBuffer).mime;
  const originalTruth = await probeSmartUploadOriginalTruth(input.originalBuffer);
  const derivativeValidation = assertValidationOk(
    await validateSmartUploadImageBytes(input.derivativeBuffer, destinations),
  );
  const originalAssetId = crypto.randomUUID();

  return runSmartUploadFinalize(store, {
    ...input,
    destinations,
    outputs: {
      original: {
        assetId: originalAssetId,
        url: input.originalAssetUrl,
        truth: originalTruth,
        mime: originalMime,
      },
      meta: {
        assetId: crypto.randomUUID(),
        url: input.derivativeAssetUrl,
        truth: derivativeValidation.truth,
        mime: derivativeValidation.mime,
        fix: input.fix,
      },
    },
    rollbackBlobPathname: null,
  });
}

export async function generateSmartUploadPreviewFix(input: {
  actor: string | null;
  finalizeKey: string;
  original: SmartUploadStagedBlobRef;
  strategy: SmartUploadFixStrategy;
  targetRatio: SmartUploadFixTargetRatio;
  destinations?: SmartUploadDestinations;
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
  const destinations = normalizeSmartUploadDestinations(input.destinations);
  const originalBuffer = await readMarketingBlobBuffer(input.original.pathname, "public");
  const fixDestinations =
    input.targetRatio === "2:3"
      ? { facebook: false, instagram: false, pinterest: true }
      : { ...destinations, pinterest: false };
  const validation = await validateSmartUploadImageBytes(originalBuffer, fixDestinations);
  if (validation.ok) {
    throw new Error("Image already passes validation for this preview target; fix is not required.");
  }
  if (!isSmartUploadAspectRatioOnlyFailure(validation.issues)) {
    throw new Error("Only invalid aspect ratio images can be fixed in Smart Upload.");
  }

  const transformed = await transformSmartUploadImage({
    buffer: originalBuffer,
    strategy: input.strategy,
    targetRatio: input.targetRatio,
    destinations: fixDestinations,
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

  try {
    const lookup = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
    if (lookup.status === "inconsistent") {
      throw new Error(lookup.reason);
    }

    const destinations =
      lookup.status === "partial"
        ? lookup.destinations
        : normalizeSmartUploadDestinations(input.destinations);
    assertAtLeastOneDestination(destinations);
    const validation = assertValidationOk(
      await validateSmartUploadImageBytes(input.imageBuffer, destinations),
    );

    if (input.bookId && !catalogBooks().some((book) => book.id === input.bookId)) {
      throw new Error("Unknown book.");
    }

    if (lookup.status === "partial") {
      const asset = assertSmartUploadAssetRecord(
        await store.getAsset(lookup.assetId),
        lookup.assetId,
      );
      const recoveredUrl = asset.url?.trim();
      if (!recoveredUrl) {
        throw new Error("Smart Upload asset is missing a URL during partial recovery.");
      }
      const outputs: SmartUploadImageOutputs = {
        original: {
          assetId: lookup.assetId,
          url: recoveredUrl,
          truth: validation.truth,
          mime: validation.mime,
        },
      };
      return await runSmartUploadFinalize(store, {
        ...input,
        destinations,
        outputs,
        rollbackBlobPathname: null,
      });
    }

    const { kind, mime } = assertImageUpload(input.imageBuffer);
    const extension = extensionForKind(kind);
    const uploaded = await uploadPublicMarketingFile(input.imageBuffer, mime, extension);
    const originalAssetId = crypto.randomUUID();
    const outputs: SmartUploadImageOutputs = {
      original: {
        assetId: originalAssetId,
        url: uploaded.url,
        truth: validation.truth,
        mime: validation.mime,
      },
    };

    return await runSmartUploadFinalize(store, {
      ...input,
      destinations,
      outputs,
      rollbackBlobPathname: uploaded.pathname,
    });
  } catch (error) {
    await observeSmartUploadFinalizeFailure(
      {
        finalizeKey: input.finalizeKey,
        batchId: input.batchId,
        sourceOperation: "smart_upload_finalize_buffer",
      },
      error,
    );
    throw error;
  }
}

export async function finalizeSmartUploadFromBlob(
  store: MarketingStore,
  input: SmartUploadBlobFinalizeInput,
): Promise<SmartUploadFinalizeResult> {
  const existing = await findSmartUploadFinalizeResult(store, input.finalizeKey);
  if (existing) return existing;

  try {
    const lookup = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
    if (lookup.status === "inconsistent") {
      throw new Error(lookup.reason);
    }

    const destinations =
      lookup.status === "partial"
        ? lookup.destinations
        : normalizeSmartUploadDestinations(input.destinations);
    assertAtLeastOneDestination(destinations);

    if (input.bookId && !catalogBooks().some((book) => book.id === input.bookId)) {
      throw new Error("Unknown book.");
    }

    const outputs = await assembleBlobFinalizeOutputs(input, destinations);
    if (lookup.status === "partial") {
      const asset = assertSmartUploadAssetRecord(
        await store.getAsset(lookup.assetId),
        lookup.assetId,
      );
      const recoveredUrl = asset.url?.trim();
      if (!recoveredUrl) {
        throw new Error("Smart Upload asset is missing a URL during partial recovery.");
      }
      outputs.original.assetId = lookup.assetId;
      outputs.original.url = recoveredUrl;
    }
    return await runSmartUploadFinalize(store, {
      ...input,
      destinations,
      outputs,
      rollbackBlobPathname: null,
    });
  } catch (error) {
    await observeSmartUploadFinalizeFailure(
      {
        finalizeKey: input.finalizeKey,
        batchId: input.batchId,
        sourceOperation: "smart_upload_finalize_blob",
      },
      error,
    );
    throw error;
  }
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
