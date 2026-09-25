import { formatAspectRatioLabel } from "./asset-truth";
import { catalogBooks } from "./brain";
import { getMarketingTimezone } from "./config";
import {
  MANUAL_UPLOAD_SOURCE,
  PRIVATE_BLOB_PATH_TAG,
} from "./content-metadata";
import { ensureUniqueResourceSlug } from "./free-resources";
import {
  assertImageUpload,
  assertResourceFileUpload,
  extensionForKind,
  probeImageDimensions,
  sanitizeUploadFilename,
} from "./file-validation";
import { deleteMarketingBlob, uploadPrivateMarketingFile, uploadPublicMarketingFile } from "./marketing-blob";
import { scanMarketingText } from "./safety";
import type { MarketingStore } from "./store";
import {
  assertResourceType,
  AUDIENCES,
  CONTENT_CATEGORIES,
  PLATFORMS,
  type AudienceId,
  type ContentCategory,
  type ContentPlacement,
  type MarketingContent,
  type Platform,
  type ResourceType,
} from "./types";
import {
  PINTEREST_ASPECT_RATIO_MAX,
  PINTEREST_ASPECT_RATIO_MIN,
  PINTEREST_MIN_IMAGE_WIDTH,
  isPinterestMimeAllowed,
} from "./platform-suitability";

export type ManualSocialPostInput = {
  platform: Platform;
  placement: ContentPlacement;
  body: string;
  pinTitle?: string | null;
  pinDescription?: string | null;
  pinAltText?: string | null;
  cta?: string | null;
  bookId?: string | null;
  category?: ContentCategory;
  audience?: AudienceId;
  scheduledFor?: string | null;
  weeklyPlanId: string;
  campaignId: string | null;
  actor: string | null;
  imageBuffer: Buffer;
  imageFilename: string;
};

export type ManualResourceInput = {
  title: string;
  description: string;
  resourceType: ResourceType;
  bookId?: string | null;
  relatedCondition?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  cta?: string | null;
  scheduledFor?: string | null;
  weeklyPlanId: string;
  campaignId: string | null;
  actor: string | null;
  previewBuffer: Buffer;
  previewFilename: string;
  fileBuffer: Buffer;
  fileFilename: string;
};

function assertPlatform(platform: string): Platform {
  if (!PLATFORMS.includes(platform as Platform)) {
    throw new Error("Unsupported platform.");
  }
  return platform as Platform;
}

function assertCategory(category: string): ContentCategory {
  if (!CONTENT_CATEGORIES.includes(category as ContentCategory)) {
    throw new Error("Unsupported category.");
  }
  return category as ContentCategory;
}

function assertAudience(audience: string): AudienceId {
  if (!AUDIENCES.includes(audience as AudienceId)) {
    throw new Error("Unsupported audience.");
  }
  return audience as AudienceId;
}

function normalizeScheduledFor(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatForSocial(platform: Platform, placement: ContentPlacement): "post" | "pin" {
  if (platform === "pinterest") {
    if (placement !== "pin") throw new Error("Pinterest uploads must use Pin placement.");
    return "pin";
  }
  if (placement !== "feed") {
    throw new Error("Only Feed placement is supported for Instagram and Facebook in v1.");
  }
  if (platform !== "instagram" && platform !== "facebook") {
    throw new Error("Unsupported social platform.");
  }
  return "post";
}

async function rollbackBlobs(pathnames: string[]) {
  for (const pathname of pathnames) {
    await deleteMarketingBlob(pathname);
  }
}

export async function createManualSocialPost(
  store: MarketingStore,
  input: ManualSocialPostInput,
) {
  const platform = assertPlatform(input.platform);
  const format = formatForSocial(platform, input.placement);
  const category = assertCategory(input.category ?? "educational");
  const audience = assertAudience(input.audience ?? "parents");
  if (input.bookId && !catalogBooks().some((book) => book.id === input.bookId)) {
    throw new Error("Unknown book.");
  }

  const { kind, mime } = assertImageUpload(input.imageBuffer);
  const dimensions = await probeImageDimensions(input.imageBuffer);
  if (platform === "pinterest") {
    if (!isPinterestMimeAllowed(dimensions.mimeType)) {
      throw new Error("Pinterest requires JPEG, PNG, or WebP images.");
    }
    if (dimensions.width < PINTEREST_MIN_IMAGE_WIDTH) {
      throw new Error(`Pinterest image width must be at least ${PINTEREST_MIN_IMAGE_WIDTH}px.`);
    }
    const ratio = dimensions.width / dimensions.height;
    if (ratio < PINTEREST_ASPECT_RATIO_MIN || ratio > PINTEREST_ASPECT_RATIO_MAX) {
      throw new Error(
        `Pinterest image aspect ratio must be between ${PINTEREST_ASPECT_RATIO_MIN.toFixed(3)} and ${PINTEREST_ASPECT_RATIO_MAX.toFixed(3)} (width/height).`,
      );
    }
    if (!input.pinTitle?.trim() || !input.pinDescription?.trim() || !input.pinAltText?.trim()) {
      throw new Error("Pinterest uploads require pin title, description, and alt text.");
    }
  }
  const extension = extensionForKind(kind);
  const uploaded = await uploadPublicMarketingFile(input.imageBuffer, mime, extension);
  const blobPathnames = [uploaded.pathname];

  try {
    const assetId = crypto.randomUUID();
    const contentId = crypto.randomUUID();
    const pinTitle = platform === "pinterest" ? input.pinTitle!.trim() : null;
    const pinDescription = platform === "pinterest" ? input.pinDescription!.trim() : input.body;
    const pinAltText = platform === "pinterest" ? input.pinAltText!.trim() : input.body.slice(0, 120);
    const flags = scanMarketingText(
      `${pinTitle ?? ""}\n${pinDescription}\n${input.cta ?? ""}`,
    );
    const warnings = ["Manual upload — image is used as provided (not re-composed)."];

    const asset = await store.createAsset({
      id: assetId,
      name: sanitizeUploadFilename(input.imageFilename),
      type: "upload",
      source: MANUAL_UPLOAD_SOURCE,
      bookId: input.bookId ?? null,
      characterId: null,
      campaignId: input.campaignId,
      approved: true,
      usageRestrictions: "Owner-uploaded social image.",
      aspectRatio: formatAspectRatioLabel(dimensions.width, dimensions.height),
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
      mimeType: dimensions.mimeType,
      tags: ["manual_upload", platform, format],
      url: uploaded.url,
      altText: pinAltText,
      isDemo: false,
    });

    const content = await store.createContent({
      id: contentId,
      campaignId: input.campaignId,
      weeklyPlanId: input.weeklyPlanId,
      platform,
      format,
      category,
      audience,
      status: "needs_review",
      title:
        platform === "pinterest"
          ? pinTitle!.slice(0, 100)
          : input.body.split("\n")[0]?.slice(0, 120) ?? `${platform} post`,
      body: pinDescription,
      cta: input.cta ?? null,
      seoTitle: null,
      seoDescription: null,
      scheduledFor: normalizeScheduledFor(input.scheduledFor),
      timezone: getMarketingTimezone(),
      assetIds: [asset.id],
      needsNewAsset: false,
      warnings,
      safetyFlags: flags,
      trackingToken: crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      originalBody: null,
      bookId: input.bookId ?? null,
      metadata: {
        source: MANUAL_UPLOAD_SOURCE,
        placement: input.placement,
        manualUploadVersion: 1,
        pinAltText: platform === "pinterest" ? pinAltText : null,
      },
      isDemo: false,
    });

    await store.addApproval({
      id: crypto.randomUUID(),
      contentId: content.id,
      action: "feedback",
      actor: input.actor,
      feedback: "Manual social post uploaded.",
      previousBody: null,
      newBody: content.body,
      preferenceSignals: [],
    });
    await store.recordEvent({
      id: crypto.randomUUID(),
      name: "manual_content_uploaded",
      campaignId: content.campaignId,
      contentId: content.id,
      platform: content.platform,
      properties: { kind: "social_post", placement: input.placement },
    });

    return { content, assets: [asset] };
  } catch (error) {
    await rollbackBlobs(blobPathnames);
    throw error;
  }
}

export async function createManualFreeResource(
  store: MarketingStore,
  input: ManualResourceInput,
) {
  const resourceType = assertResourceType(input.resourceType);
  const category = assertCategory("educational");
  const audience = assertAudience("parents");
  if (input.bookId && !catalogBooks().some((book) => book.id === input.bookId)) {
    throw new Error("Unknown book.");
  }

  const preview = assertImageUpload(input.previewBuffer);
  const file = assertResourceFileUpload(input.fileBuffer);
  const previewDimensions = await probeImageDimensions(input.previewBuffer);

  const previewUpload = await uploadPublicMarketingFile(
    input.previewBuffer,
    preview.mime,
    extensionForKind(preview.kind),
  );
  const fileUpload = await uploadPrivateMarketingFile(
    input.fileBuffer,
    file.mime,
    extensionForKind(file.kind),
  );
  const blobPathnames = [previewUpload.pathname, fileUpload.pathname];

  try {
    const previewAssetId = crypto.randomUUID();
    const fileAssetId = crypto.randomUUID();
    const contentId = crypto.randomUUID();
    const slug = await ensureUniqueResourceSlug(store, input.title);
    const flags = scanMarketingText(
      `${input.title}\n${input.description}\n${input.seoTitle ?? ""}\n${input.seoDescription ?? ""}`,
    );
    const warnings = [
      "Manual free resource — publish will create a public landing page.",
    ];

    const previewAsset = await store.createAsset({
      id: previewAssetId,
      name: sanitizeUploadFilename(input.previewFilename),
      type: "resource_preview",
      source: MANUAL_UPLOAD_SOURCE,
      bookId: input.bookId ?? null,
      characterId: null,
      campaignId: input.campaignId,
      approved: true,
      usageRestrictions: "Public preview image for free resource page.",
      aspectRatio: formatAspectRatioLabel(previewDimensions.width, previewDimensions.height),
      imageWidth: previewDimensions.width,
      imageHeight: previewDimensions.height,
      mimeType: previewDimensions.mimeType,
      tags: ["manual_upload", "resource_preview"],
      url: previewUpload.url,
      altText: input.title,
      isDemo: false,
    });

    const fileAsset = await store.createAsset({
      id: fileAssetId,
      name: sanitizeUploadFilename(input.fileFilename),
      type: "resource_file",
      source: MANUAL_UPLOAD_SOURCE,
      bookId: input.bookId ?? null,
      characterId: null,
      campaignId: input.campaignId,
      approved: true,
      usageRestrictions: "Private downloadable file — not exposed as a public URL.",
      aspectRatio: null,
      imageWidth: null,
      imageHeight: null,
      mimeType: file.mime,
      tags: [`${PRIVATE_BLOB_PATH_TAG}${fileUpload.pathname}`, "manual_upload", "resource_file"],
      url: null,
      altText: input.title,
      isDemo: false,
    });

    const content = await store.createContent({
      id: contentId,
      campaignId: input.campaignId,
      weeklyPlanId: input.weeklyPlanId,
      platform: "website",
      format: "free_resource",
      category,
      audience,
      status: "needs_review",
      title: input.title,
      body: input.description,
      cta: input.cta ?? null,
      seoTitle: input.seoTitle ?? input.title,
      seoDescription: input.seoDescription ?? input.description.slice(0, 160),
      scheduledFor: normalizeScheduledFor(input.scheduledFor),
      timezone: getMarketingTimezone(),
      assetIds: [previewAsset.id, fileAsset.id],
      needsNewAsset: false,
      warnings,
      safetyFlags: flags,
      trackingToken: null,
      originalBody: null,
      bookId: input.bookId ?? null,
      metadata: {
        source: MANUAL_UPLOAD_SOURCE,
        manualUploadVersion: 1,
        resourceType,
        slug,
        relatedCondition: input.relatedCondition ?? null,
      },
      isDemo: false,
    });

    await store.addApproval({
      id: crypto.randomUUID(),
      contentId: content.id,
      action: "feedback",
      actor: input.actor,
      feedback: "Manual free resource uploaded.",
      previousBody: null,
      newBody: content.body,
      preferenceSignals: [],
    });
    await store.recordEvent({
      id: crypto.randomUUID(),
      name: "manual_content_uploaded",
      campaignId: content.campaignId,
      contentId: content.id,
      platform: "website",
      properties: { kind: "free_resource", slug },
    });

    return { content, assets: [previewAsset, fileAsset] };
  } catch (error) {
    await rollbackBlobs(blobPathnames);
    throw error;
  }
}

export function parseManualSocialForm(form: FormData): Omit<
  ManualSocialPostInput,
  "imageBuffer" | "imageFilename" | "weeklyPlanId" | "campaignId" | "actor"
> {
  const platform = String(form.get("platform") ?? "");
  const placement = String(form.get("placement") ?? "feed") as ContentPlacement;
  const platformValue = assertPlatform(platform);
  const pinTitle = String(form.get("pinTitle") ?? "").trim();
  const pinDescription = String(form.get("pinDescription") ?? "").trim();
  const pinAltText = String(form.get("pinAltText") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  if (platformValue === "pinterest") {
    if (!pinTitle || !pinDescription || !pinAltText) {
      throw new Error("Pinterest uploads require pin title, description, and alt text.");
    }
  } else if (!body) {
    throw new Error("Caption is required.");
  }
  return {
    platform: platformValue,
    placement,
    body: platformValue === "pinterest" ? pinDescription : body,
    pinTitle: platformValue === "pinterest" ? pinTitle : null,
    pinDescription: platformValue === "pinterest" ? pinDescription : null,
    pinAltText: platformValue === "pinterest" ? pinAltText : null,
    cta: String(form.get("cta") ?? "").trim() || null,
    bookId: String(form.get("bookId") ?? "").trim() || null,
    category: form.get("category") ? assertCategory(String(form.get("category"))) : undefined,
    audience: form.get("audience") ? assertAudience(String(form.get("audience"))) : undefined,
    scheduledFor: normalizeScheduledFor(String(form.get("scheduledFor") ?? "").trim() || null),
  };
}

export async function readSingleImageFromForm(form: FormData): Promise<{ buffer: Buffer; filename: string }> {
  const files = form.getAll("image").filter((item): item is File => item instanceof File);
  if (files.length !== 1) {
    throw new Error("Upload exactly one image. Carousel and multi-image posts are not supported in v1.");
  }
  const file = files[0];
  const buffer = Buffer.from(await file.arrayBuffer());
  return { buffer, filename: file.name || "upload.jpg" };
}

export async function readResourceFilesFromForm(form: FormData) {
  const preview = form.get("preview");
  const resourceFile = form.get("file");
  if (!(preview instanceof File) || !(resourceFile instanceof File)) {
    throw new Error("Preview image and downloadable file are required.");
  }
  return {
    previewBuffer: Buffer.from(await preview.arrayBuffer()),
    previewFilename: preview.name || "preview.jpg",
    fileBuffer: Buffer.from(await resourceFile.arrayBuffer()),
    fileFilename: resourceFile.name || "resource.pdf",
  };
}

export function parseManualResourceForm(form: FormData): Omit<
  ManualResourceInput,
  | "previewBuffer"
  | "previewFilename"
  | "fileBuffer"
  | "fileFilename"
  | "weeklyPlanId"
  | "campaignId"
  | "actor"
> {
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  if (!title) throw new Error("Title is required.");
  if (!description) throw new Error("Description is required.");
  return {
    title,
    description,
    resourceType: assertResourceType(String(form.get("resourceType") ?? "other")),
    bookId: String(form.get("bookId") ?? "").trim() || null,
    relatedCondition: String(form.get("relatedCondition") ?? "").trim() || null,
    seoTitle: String(form.get("seoTitle") ?? "").trim() || null,
    seoDescription: String(form.get("seoDescription") ?? "").trim() || null,
    cta: String(form.get("cta") ?? "").trim() || null,
    scheduledFor: normalizeScheduledFor(String(form.get("scheduledFor") ?? "").trim() || null),
  };
}

export function isPublishedFreeResource(content: MarketingContent): boolean {
  return content.platform === "website" && content.format === "free_resource" && content.status === "published";
}
