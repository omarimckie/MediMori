import { formatAspectRatioLabel, type AssetImageTruth } from "./asset-truth";
import { getMarketingTimezone } from "./config";
import { SMART_UPLOAD_SOURCE } from "./content-metadata";
import { sanitizeUploadFilename } from "./file-validation";
import { truncatePinterestDescription, truncatePinterestTitle } from "./pinterest";
import { scanMarketingText } from "./safety";
import {
  isSmartUploadFinalizeKeyConflict,
  type SmartUploadFinalizeLookup,
} from "./smart-upload-idempotency";
import type { SmartUploadStagedBlobRef } from "./smart-upload-api";
import {
  metaDestinationsSelected,
  type SmartUploadDestinations,
} from "./smart-upload-destinations";
import { SMART_UPLOAD_DERIVATIVE_TAG, smartUploadOriginalTag } from "./smart-upload-fix";
import type {
  SmartUploadFinalizeInput,
  SmartUploadFinalizeResult,
  SmartUploadFixFinalizeBundle,
  SmartUploadPlatformCaptions,
} from "./smart-upload";

export function resolveSmartUploadFinalizeCaptions(
  input: Pick<SmartUploadFinalizeInput, "caption" | "platformCaptions">,
  destinations: SmartUploadDestinations,
): SmartUploadPlatformCaptions & { primaryForAssetAlt: string } {
  const platform = input.platformCaptions;
  if (platform) {
    const facebook = platform.facebook.trim();
    const instagram = platform.instagram.trim();
    if (destinations.facebook && !facebook) {
      throw new Error("Facebook caption is required when Facebook is selected.");
    }
    if (destinations.instagram && !instagram) {
      throw new Error("Instagram caption is required when Instagram is selected.");
    }
    const primaryForAssetAlt = instagram || facebook || "";
    return {
      facebook: destinations.facebook ? facebook : "",
      instagram: destinations.instagram ? instagram : "",
      primaryForAssetAlt,
    };
  }
  const caption = input.caption.trim();
  if (metaDestinationsSelected(destinations) && !caption) {
    throw new Error("Caption is required for selected Meta destinations.");
  }
  return {
    facebook: destinations.facebook ? caption : "",
    instagram: destinations.instagram ? caption : "",
    primaryForAssetAlt: caption,
  };
}

export function resolveSmartUploadPinterestCopy(input: {
  destinations: SmartUploadDestinations;
  pinterestTitle?: string | null;
  pinterestDescription?: string | null;
}): SmartUploadPinterestCopy | null {
  if (!input.destinations.pinterest) return null;
  const title = input.pinterestTitle?.trim() ?? "";
  const description = input.pinterestDescription?.trim() ?? "";
  if (!title || !description) {
    throw new Error("Pinterest title and description are required when Pinterest is selected.");
  }
  return { title, description };
}
import type { MarketingStore } from "./store";
import type {
  AudienceId,
  ContentCategory,
  MarketingAsset,
  MarketingContent,
  MarketingContentMetadata,
  SafetyFlag,
} from "./types";

export type SmartUploadPinterestCopy = {
  title: string;
  description: string;
};

export type SmartUploadImageOutputs = {
  original: { assetId: string; url: string; truth: AssetImageTruth; mime: string };
  meta?: { assetId: string; url: string; truth: AssetImageTruth; mime: string; fix?: SmartUploadFixFinalizeBundle };
  pinterest?: { assetId: string; url: string; truth: AssetImageTruth; mime: string; fix?: SmartUploadFixFinalizeBundle };
};

type OwnedFinalizeResources = {
  contentIds: string[];
  createdAssetIds: string[];
  blobPathname: string | null;
};

export function finalizeResultFromLookup(
  lookup: Extract<SmartUploadFinalizeLookup, { status: "complete" }>,
  idempotentReplay: boolean,
): SmartUploadFinalizeResult {
  return {
    assetId: lookup.assetId,
    destinations: lookup.destinations,
    instagramContentId: lookup.instagram?.id ?? null,
    facebookContentId: lookup.facebook?.id ?? null,
    pinterestContentId: lookup.pinterest?.id ?? null,
    instagram: lookup.instagram,
    facebook: lookup.facebook,
    pinterest: lookup.pinterest,
    idempotentReplay,
  };
}

function sharedMetadata(
  input: SmartUploadFinalizeInput,
  destinations: SmartUploadDestinations,
  originalAssetId: string,
  extra?: Partial<MarketingContentMetadata>,
): MarketingContentMetadata {
  return {
    source: "smart_upload",
    batchId: input.batchId,
    smartUploadFinalizeKey: input.finalizeKey,
    smartUploadVersion: 2,
    smartUploadDestinations: destinations,
    originalAssetId,
    ...extra,
  };
}

async function createOriginalAsset(
  store: MarketingStore,
  input: SmartUploadFinalizeInput,
  campaignId: string | null,
  assetId: string,
  url: string,
  truth: AssetImageTruth,
  altCaption: string,
): Promise<MarketingAsset> {
  return store.createAsset({
    id: assetId,
    name: sanitizeUploadFilename(input.imageFilename ?? "upload.jpg"),
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
    bookId: input.bookId ?? null,
    characterId: null,
    campaignId,
    approved: true,
    usageRestrictions: "Smart Upload original image (immutable).",
    aspectRatio: formatAspectRatioLabel(truth.width, truth.height),
    imageWidth: truth.width,
    imageHeight: truth.height,
    mimeType: truth.mimeType,
    tags: ["smart_upload", `batch:${input.batchId}`],
    url,
    altText: altCaption.slice(0, 120),
    isDemo: false,
  });
}

async function createDerivativeAsset(
  store: MarketingStore,
  input: SmartUploadFinalizeInput,
  campaignId: string | null,
  assetId: string,
  url: string,
  truth: AssetImageTruth,
  originalAssetId: string,
  fix: SmartUploadFixFinalizeBundle,
  altCaption: string,
): Promise<MarketingAsset> {
  return store.createAsset({
    id: assetId,
    name: `${sanitizeUploadFilename(input.imageFilename ?? "upload.jpg")} (${fix.targetRatio})`,
    type: "upload",
    source: SMART_UPLOAD_SOURCE,
    bookId: input.bookId ?? null,
    characterId: null,
    campaignId,
    approved: true,
    usageRestrictions: `Smart Upload derivative (${fix.strategy}, ${fix.targetRatio}).`,
    aspectRatio: formatAspectRatioLabel(truth.width, truth.height),
    imageWidth: truth.width,
    imageHeight: truth.height,
    mimeType: truth.mimeType,
    tags: [
      "smart_upload",
      SMART_UPLOAD_DERIVATIVE_TAG,
      smartUploadOriginalTag(originalAssetId),
      `batch:${input.batchId}`,
    ],
    url,
    altText: altCaption.slice(0, 120),
    isDemo: false,
  });
}

function scanCaptionSafety(
  resolved: SmartUploadPlatformCaptions & { primaryForAssetAlt: string },
  pinterest: SmartUploadPinterestCopy | null,
): SafetyFlag[] {
  const chunks = [resolved.instagram, resolved.facebook];
  if (pinterest) chunks.push(pinterest.title, pinterest.description);
  return scanMarketingText(chunks.join("\n"));
}

function buildWarnings(destinations: SmartUploadDestinations): string[] {
  const parts: string[] = [];
  if (metaDestinationsSelected(destinations)) {
    parts.push("Meta feed");
  }
  if (destinations.pinterest) parts.push("Pinterest pin");
  return [`Smart Upload — image validated for ${parts.join(" and ")}.`];
}

export async function persistSmartUploadMultiPlatform(
  store: MarketingStore,
  input: SmartUploadFinalizeInput & {
    destinations: SmartUploadDestinations;
    pinterestCopy: SmartUploadPinterestCopy | null;
    weeklyPlanId: string | null;
    campaignId: string | null;
    outputs: SmartUploadImageOutputs;
    rollbackBlobPathname: string | null;
  },
): Promise<SmartUploadFinalizeResult> {
  const initialLookup = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
  if (initialLookup.status === "inconsistent") {
    throw new Error(initialLookup.reason);
  }
  if (initialLookup.status === "complete") {
    return finalizeResultFromLookup(initialLookup, true);
  }
  const recoveringPartial = initialLookup.status === "partial";
  const existingInstagram =
    initialLookup.status === "partial" ? initialLookup.instagram : null;
  const existingFacebook = initialLookup.status === "partial" ? initialLookup.facebook : null;
  const existingPinterest = initialLookup.status === "partial" ? initialLookup.pinterest : null;

  const resolved = resolveSmartUploadFinalizeCaptions(input, input.destinations);
  const flags = scanCaptionSafety(resolved, input.pinterestCopy);
  const warnings = buildWarnings(input.destinations);
  const originalAssetId = input.outputs.original.assetId;

  const baseContent = {
    campaignId: input.campaignId,
    weeklyPlanId: input.weeklyPlanId,
    category: input.category ?? "educational",
    audience: input.audience ?? "parents",
    status: "needs_review" as const,
    cta: null,
    seoTitle: null,
    seoDescription: null,
    scheduledFor: null,
    timezone: getMarketingTimezone(),
    needsNewAsset: false,
    warnings,
    safetyFlags: flags,
    originalBody: null,
    bookId: input.bookId ?? null,
    isDemo: false,
  };

  const owned: OwnedFinalizeResources = {
    contentIds: [],
    createdAssetIds: [],
    blobPathname: input.rollbackBlobPathname,
  };

  const metaAssetId = input.outputs.meta?.assetId ?? input.outputs.original.assetId;
  const pinAssetId =
    input.outputs.pinterest?.assetId ?? input.outputs.meta?.assetId ?? input.outputs.original.assetId;

  try {
    if (!existingInstagram && input.destinations.instagram) {
      const metaFix = input.outputs.meta?.fix;
      const instagram = await store.createContent({
        ...baseContent,
        id: crypto.randomUUID(),
        platform: "instagram",
        format: "post",
        body: resolved.instagram,
        title: resolved.instagram.split("\n")[0]?.slice(0, 120) ?? "Instagram post",
        assetIds: [metaAssetId],
        trackingToken: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
        metadata: sharedMetadata(input, input.destinations, originalAssetId, {
          placement: "feed",
          ...(metaFix
            ? {
                smartUploadFixStrategy: metaFix.strategy,
                smartUploadFixTargetRatio: metaFix.targetRatio,
              }
            : {}),
        }),
      });
      owned.contentIds.push(instagram.id);
    }

    if (!existingFacebook && input.destinations.facebook) {
      const metaFix = input.outputs.meta?.fix;
      const facebook = await store.createContent({
        ...baseContent,
        id: crypto.randomUUID(),
        platform: "facebook",
        format: "post",
        body: resolved.facebook,
        title: resolved.facebook.split("\n")[0]?.slice(0, 120) ?? "Facebook post",
        assetIds: [metaAssetId],
        trackingToken: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
        metadata: sharedMetadata(input, input.destinations, originalAssetId, {
          placement: "feed",
          ...(metaFix
            ? {
                smartUploadFixStrategy: metaFix.strategy,
                smartUploadFixTargetRatio: metaFix.targetRatio,
              }
            : {}),
        }),
      });
      owned.contentIds.push(facebook.id);
    }

    if (!existingPinterest && input.destinations.pinterest && input.pinterestCopy) {
      const pinFix = input.outputs.pinterest?.fix;
      const title = truncatePinterestTitle(input.pinterestCopy.title);
      const description = truncatePinterestDescription(input.pinterestCopy.description);
      const pinterest = await store.createContent({
        ...baseContent,
        id: crypto.randomUUID(),
        platform: "pinterest",
        format: "pin",
        body: description,
        title,
        assetIds: [pinAssetId],
        trackingToken: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
        metadata: sharedMetadata(input, input.destinations, originalAssetId, {
          placement: "pin",
          pinAltText: title,
          ...(pinFix
            ? {
                smartUploadFixStrategy: pinFix.strategy,
                smartUploadFixTargetRatio: pinFix.targetRatio,
              }
            : {}),
        }),
      });
      owned.contentIds.push(pinterest.id);
    }

    const existingOriginal = await store.getAsset(originalAssetId);
    if (!existingOriginal) {
      await createOriginalAsset(
        store,
        input,
        input.campaignId,
        originalAssetId,
        input.outputs.original.url,
        input.outputs.original.truth,
        resolved.primaryForAssetAlt,
      );
      owned.createdAssetIds.push(originalAssetId);
    }

    if (input.outputs.meta && input.outputs.meta.assetId !== originalAssetId) {
      const metaFix = input.outputs.meta.fix;
      if (metaFix) {
        await createDerivativeAsset(
          store,
          input,
          input.campaignId,
          input.outputs.meta.assetId,
          input.outputs.meta.url,
          input.outputs.meta.truth,
          originalAssetId,
          metaFix,
          resolved.primaryForAssetAlt,
        );
        owned.createdAssetIds.push(input.outputs.meta.assetId);
      }
    }

    if (
      input.outputs.pinterest &&
      input.outputs.pinterest.assetId !== originalAssetId &&
      input.outputs.pinterest.assetId !== input.outputs.meta?.assetId
    ) {
      const pinFix = input.outputs.pinterest.fix;
      if (pinFix) {
        await createDerivativeAsset(
          store,
          input,
          input.campaignId,
          input.outputs.pinterest.assetId,
          input.outputs.pinterest.url,
          input.outputs.pinterest.truth,
          originalAssetId,
          pinFix,
          input.pinterestCopy?.title ?? resolved.primaryForAssetAlt,
        );
        owned.createdAssetIds.push(input.outputs.pinterest.assetId);
      }
    }

    const lookup = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
    if (lookup.status === "complete") {
      return finalizeResultFromLookup(lookup, recoveringPartial);
    }
    throw new Error("Smart Upload finalize did not reach a complete state.");
  } catch (error) {
    if (isSmartUploadFinalizeKeyConflict(error)) {
      const after = await store.findSmartUploadContentByFinalizeKey(input.finalizeKey);
      if (after.status === "complete") {
        return finalizeResultFromLookup(after, true);
      }
      if (after.status === "partial") {
        throw error;
      }
    }
    for (const contentId of owned.contentIds) {
      await store.deleteContent(contentId);
    }
    for (const assetId of owned.createdAssetIds) {
      await store.deleteAsset(assetId);
    }
    throw error;
  }
}
