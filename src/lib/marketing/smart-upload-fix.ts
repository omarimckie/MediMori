import sharp from "sharp";
import { truthFromDimensions, type AssetImageTruth } from "./asset-truth";
import {
  assertImageUpload,
  detectFileKind,
  mimeForDetectedKind,
  probeImageDimensions,
} from "./file-validation";
import { MAX_MARKETING_IMAGE_BYTES } from "./upload-limits";
import {
  isAssetSuitableForPlatform,
  INSTAGRAM_FEED_ASPECT_RATIO_MAX,
  INSTAGRAM_FEED_ASPECT_RATIO_MIN,
} from "./platform-suitability";
import type { SmartUploadValidationIssue } from "./smart-upload";

export type SmartUploadFixStrategy = "pad" | "crop";
export type SmartUploadFixTargetRatio = "4:5" | "1:1";

export const SMART_UPLOAD_FIX_PAD_BACKGROUND = "#ffffff";

/** Max edge length for source images before transform (pixels). */
export const SMART_UPLOAD_FIX_MAX_INPUT_EDGE = 8192;

/** Max edge length for transformed output (pixels). */
export const SMART_UPLOAD_FIX_MAX_OUTPUT_EDGE = 4096;

/** Sharp decompression bomb guard (pixels). */
export const SMART_UPLOAD_FIX_MAX_INPUT_PIXELS = 32_000_000;

export const SMART_UPLOAD_FIX_MAX_OUTPUT_BYTES = MAX_MARKETING_IMAGE_BYTES;

export const SMART_UPLOAD_DERIVATIVE_TAG = "smart_upload:derivative";
export const smartUploadOriginalTag = (originalAssetId: string) =>
  `smart_upload:original:${originalAssetId}`;

export function targetRatioValue(target: SmartUploadFixTargetRatio): number {
  return target === "4:5" ? 4 / 5 : 1;
}

export function isSmartUploadAspectRatioOnlyFailure(
  issues: SmartUploadValidationIssue[],
): boolean {
  if (!issues.length) return false;
  return issues.every((issue) => issue.code === "invalid_aspect_ratio");
}

export function assertTransformInputWithinLimits(width: number, height: number): void {
  const maxEdge = Math.max(width, height);
  if (maxEdge > SMART_UPLOAD_FIX_MAX_INPUT_EDGE) {
    throw new Error(
      `Image is too large to transform (${maxEdge}px edge exceeds ${SMART_UPLOAD_FIX_MAX_INPUT_EDGE}px). Use a smaller source image.`,
    );
  }
  const pixels = width * height;
  if (pixels > SMART_UPLOAD_FIX_MAX_INPUT_PIXELS) {
    throw new Error(
      `Image has too many pixels to transform safely (${pixels} exceeds limit). Use a smaller source image.`,
    );
  }
}

export function outputCanvasDimensions(
  sourceWidth: number,
  sourceHeight: number,
  targetRatio: number,
  strategy: SmartUploadFixStrategy,
): { width: number; height: number } {
  const sourceRatio = sourceWidth / sourceHeight;
  if (strategy === "pad") {
    if (sourceRatio > targetRatio) {
      const width = sourceWidth;
      const height = Math.max(1, Math.round(width / targetRatio));
      return clampOutputDimensions(width, height);
    }
    const height = sourceHeight;
    const width = Math.max(1, Math.round(height * targetRatio));
    return clampOutputDimensions(width, height);
  }
  if (sourceRatio > targetRatio) {
    const height = sourceHeight;
    const width = Math.max(1, Math.round(height * targetRatio));
    return clampOutputDimensions(width, height);
  }
  const width = sourceWidth;
  const height = Math.max(1, Math.round(width / targetRatio));
  return clampOutputDimensions(width, height);
}

function clampOutputDimensions(width: number, height: number): { width: number; height: number } {
  const maxEdge = Math.max(width, height);
  if (maxEdge <= SMART_UPLOAD_FIX_MAX_OUTPUT_EDGE) {
    return { width, height };
  }
  const scale = SMART_UPLOAD_FIX_MAX_OUTPUT_EDGE / maxEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function transformSmartUploadImage(input: {
  buffer: Buffer;
  strategy: SmartUploadFixStrategy;
  targetRatio: SmartUploadFixTargetRatio;
}): Promise<{ buffer: Buffer; mime: string; truth: AssetImageTruth }> {
  const { kind } = assertImageUpload(input.buffer);
  const { width, height } = await probeImageDimensions(input.buffer);
  assertTransformInputWithinLimits(width, height);

  const ratio = targetRatioValue(input.targetRatio);
  const { width: canvasW, height: canvasH } = outputCanvasDimensions(
    width,
    height,
    ratio,
    input.strategy,
  );

  const pipeline = sharp(input.buffer, {
    limitInputPixels: SMART_UPLOAD_FIX_MAX_INPUT_PIXELS,
  });

  let output: Buffer;
  if (input.strategy === "pad") {
    output = await pipeline
      .resize(canvasW, canvasH, {
        fit: "contain",
        background: SMART_UPLOAD_FIX_PAD_BACKGROUND,
      })
      .toFormat(kind === "jpeg" ? "jpeg" : kind === "webp" ? "webp" : "png", {
        quality: kind === "jpeg" || kind === "webp" ? 90 : undefined,
      })
      .toBuffer();
  } else {
    output = await pipeline
      .resize(canvasW, canvasH, { fit: "cover", position: "centre" })
      .toFormat(kind === "jpeg" ? "jpeg" : kind === "webp" ? "webp" : "png", {
        quality: kind === "jpeg" || kind === "webp" ? 90 : undefined,
      })
      .toBuffer();
  }

  if (output.length > SMART_UPLOAD_FIX_MAX_OUTPUT_BYTES) {
    throw new Error(
      `Transformed image exceeds ${SMART_UPLOAD_FIX_MAX_OUTPUT_BYTES} byte limit. Try a smaller source or different settings.`,
    );
  }

  const outKind = detectFileKind(output);
  const outMime = mimeForDetectedKind(outKind);
  if (!outMime) {
    throw new Error("Transformed image has an unsupported type.");
  }
  const dimensions = await probeImageDimensions(output);
  const truth = truthFromDimensions(dimensions.width, dimensions.height, dimensions.mimeType);
  assertDualPlatformSuitability(truth);
  return { buffer: output, mime: outMime, truth };
}

function assertDualPlatformSuitability(truth: AssetImageTruth): void {
  if (!isAssetSuitableForPlatform(truth, "instagram", "post")) {
    throw new Error("Transformed image is not suitable for Instagram feed.");
  }
  if (!isAssetSuitableForPlatform(truth, "facebook", "post")) {
    throw new Error("Transformed image is not suitable for Facebook feed.");
  }
  const ratio = truth.aspectRatio;
  if (ratio < INSTAGRAM_FEED_ASPECT_RATIO_MIN || ratio > INSTAGRAM_FEED_ASPECT_RATIO_MAX) {
    throw new Error(
      `Transformed aspect ratio ${ratio.toFixed(3)} is outside the shared Smart Upload range.`,
    );
  }
}

export function parseSmartUploadFixStrategy(value: string): SmartUploadFixStrategy {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pad") return "pad";
  if (normalized === "crop") return "crop";
  throw new Error("strategy must be pad or crop.");
}

export function parseSmartUploadFixTargetRatio(value: string): SmartUploadFixTargetRatio {
  const normalized = value.trim();
  if (normalized === "4:5" || normalized === "4/5") return "4:5";
  if (normalized === "1:1" || normalized === "square" || normalized === "1/1") return "1:1";
  throw new Error("targetRatio must be 4:5 or 1:1.");
}
