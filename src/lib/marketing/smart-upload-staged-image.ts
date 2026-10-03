import { isMarketingPublicResourcePreviewPathname, readMarketingBlobBuffer } from "./marketing-blob";
import { verifySmartUploadStagedDisplayIntentForPathname } from "./smart-upload-intent";

export const SMART_UPLOAD_STAGED_IMAGE_CACHE_CONTROL = "private, no-store";

export function mimeTypeForSmartUploadStagedPathname(pathname: string): string {
  const lower = pathname.trim().toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  throw new Error("Invalid smart upload pathname.");
}

let bufferReaderForTests: ((pathname: string) => Promise<Buffer>) | null = null;

export function setSmartUploadStagedImageBufferReaderForTests(
  reader: ((pathname: string) => Promise<Buffer>) | null,
): void {
  bufferReaderForTests = reader;
}

export type SmartUploadStagedImageResult =
  | { kind: "not_found" }
  | { kind: "image"; buffer: Buffer; mimeType: string };

export function smartUploadStagedImageErrorStatus(message: string): number {
  if (/Unauthorized/i.test(message)) return 401;
  if (
    /intent|expired|signature|match|Invalid|Unsupported|pathname|required/i.test(message)
  ) {
    return 400;
  }
  return 404;
}

export async function resolveSmartUploadStagedImage(
  pathname: string,
  uploadIntent: string,
  actorUsername: string | null,
): Promise<SmartUploadStagedImageResult> {
  const trimmedPath = pathname.trim();
  const trimmedIntent = uploadIntent.trim();
  if (!trimmedPath || !trimmedIntent) {
    throw new Error("pathname and uploadIntent are required.");
  }
  if (!isMarketingPublicResourcePreviewPathname(trimmedPath)) {
    throw new Error("Invalid smart upload pathname.");
  }

  verifySmartUploadStagedDisplayIntentForPathname(
    trimmedIntent,
    actorUsername,
    trimmedPath,
  );

  const mimeType = mimeTypeForSmartUploadStagedPathname(trimmedPath);

  try {
    const buffer = bufferReaderForTests
      ? await bufferReaderForTests(trimmedPath)
      : await readMarketingBlobBuffer(trimmedPath, "public");
    return { kind: "image", buffer, mimeType };
  } catch {
    return { kind: "not_found" };
  }
}

export function smartUploadStagedImageResponse(
  result: SmartUploadStagedImageResult,
): Response {
  if (result.kind === "not_found") {
    return new Response(JSON.stringify({ error: "Not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": result.mimeType,
      "Content-Length": String(result.buffer.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": SMART_UPLOAD_STAGED_IMAGE_CACHE_CONTROL,
    },
  });
}
