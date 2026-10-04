import sharp from "sharp";
import {
  assertImageUpload,
  detectFileKind,
  mimeForDetectedKind,
  probeImageDimensions,
} from "./file-validation";
import { readMarketingBlobBuffer } from "./marketing-blob";
import { assertTransformInputWithinLimits } from "./smart-upload-fix";
import { verifySmartUploadStagedDisplayIntentForPathname } from "./smart-upload-intent";

export const SMART_UPLOAD_MODEL_IMAGE_MAX_EDGE_PX = 1536;
export const SMART_UPLOAD_MODEL_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

let bufferReaderForTests: ((pathname: string) => Promise<Buffer>) | null = null;
let dimensionsProbeForTests:
  | ((buffer: Buffer) => Promise<{ width: number; height: number; mimeType: string }>)
  | null = null;

export function setSmartUploadCaptionBufferReaderForTests(
  reader: ((pathname: string) => Promise<Buffer>) | null,
): void {
  bufferReaderForTests = reader;
}

export function setSmartUploadCaptionDimensionsProbeForTests(
  probe: ((buffer: Buffer) => Promise<{ width: number; height: number; mimeType: string }>) | null,
): void {
  dimensionsProbeForTests = probe;
}

export async function readSmartUploadCaptionImageBuffer(
  pathname: string,
  uploadIntent: string,
  actorUsername: string | null,
): Promise<Buffer> {
  verifySmartUploadStagedDisplayIntentForPathname(uploadIntent, actorUsername, pathname);
  if (bufferReaderForTests) {
    return bufferReaderForTests(pathname);
  }
  return readMarketingBlobBuffer(pathname, "public");
}

export type SmartUploadModelImageInput = {
  mimeType: string;
  base64: string;
  encodedByteLength: number;
};

/**
 * In-memory downscale/re-encode for model input only. Does not write blobs.
 */
export async function prepareSmartUploadModelImageInput(buffer: Buffer): Promise<SmartUploadModelImageInput> {
  assertImageUpload(buffer);
  const dimensions = dimensionsProbeForTests
    ? await dimensionsProbeForTests(buffer)
    : await probeImageDimensions(buffer);
  assertTransformInputWithinLimits(dimensions.width, dimensions.height);

  const kind = detectFileKind(buffer);
  let pipeline = sharp(buffer, { failOn: "none" }).rotate();
  const metadata = await pipeline.metadata();
  const width = metadata.width ?? dimensions.width;
  const height = metadata.height ?? dimensions.height;
  assertTransformInputWithinLimits(width, height);
  if (width > SMART_UPLOAD_MODEL_IMAGE_MAX_EDGE_PX || height > SMART_UPLOAD_MODEL_IMAGE_MAX_EDGE_PX) {
    pipeline = pipeline.resize({
      width: SMART_UPLOAD_MODEL_IMAGE_MAX_EDGE_PX,
      height: SMART_UPLOAD_MODEL_IMAGE_MAX_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  let mimeType = mimeForDetectedKind(kind) ?? "image/jpeg";
  let encoded: Buffer;
  if (kind === "png") {
    encoded = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    mimeType = "image/png";
  } else if (kind === "webp") {
    encoded = await pipeline.webp({ quality: 82 }).toBuffer();
    mimeType = "image/webp";
  } else {
    encoded = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    mimeType = "image/jpeg";
  }

  if (encoded.length > SMART_UPLOAD_MODEL_IMAGE_MAX_BYTES) {
    const scale = Math.sqrt(SMART_UPLOAD_MODEL_IMAGE_MAX_BYTES / encoded.length) * 0.95;
    const targetW = Math.max(1, Math.floor(width * scale));
    encoded = await sharp(buffer)
      .rotate()
      .resize({ width: targetW, withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer();
    mimeType = "image/jpeg";
  }

  return {
    mimeType,
    base64: encoded.toString("base64"),
    encodedByteLength: encoded.length,
  };
}
