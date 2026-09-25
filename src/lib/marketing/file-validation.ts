export const MAX_MARKETING_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_MARKETING_PDF_BYTES = 25 * 1024 * 1024;

export type DetectedFileKind = "jpeg" | "png" | "webp" | "pdf" | "unknown";

const JPEG_SIG = [0xff, 0xd8, 0xff];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_SIG = [0x25, 0x50, 0x44, 0x46]; // %PDF

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

export function detectFileKind(buffer: Buffer): DetectedFileKind {
  if (startsWith(buffer, JPEG_SIG)) return "jpeg";
  if (startsWith(buffer, PNG_SIG)) return "png";
  if (startsWith(buffer, PDF_SIG)) return "pdf";
  if (buffer.length >= 12) {
    const riff = buffer.toString("ascii", 0, 4);
    const webp = buffer.toString("ascii", 8, 12);
    if (riff === "RIFF" && webp === "WEBP") return "webp";
  }
  return "unknown";
}

export function mimeForDetectedKind(kind: DetectedFileKind): string | null {
  switch (kind) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    default:
      return null;
  }
}

export function extensionForKind(kind: DetectedFileKind): string {
  switch (kind) {
    case "jpeg":
      return ".jpg";
    case "png":
      return ".png";
    case "webp":
      return ".webp";
    case "pdf":
      return ".pdf";
    default:
      return ".bin";
  }
}

export function sanitizeUploadFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "upload";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 120) || "upload";
}

export function assertImageUpload(buffer: Buffer, maxBytes = MAX_MARKETING_IMAGE_BYTES): {
  kind: DetectedFileKind;
  mime: string;
} {
  if (buffer.length > maxBytes) {
    throw new Error(`Image exceeds ${maxBytes} byte limit.`);
  }
  const kind = detectFileKind(buffer);
  const mime = mimeForDetectedKind(kind);
  if (!mime || kind === "pdf") {
    throw new Error("Unsupported image type. Use JPEG, PNG, or WebP.");
  }
  return { kind, mime };
}

export function assertResourceFileUpload(
  buffer: Buffer,
  maxPdfBytes = MAX_MARKETING_PDF_BYTES,
  maxImageBytes = MAX_MARKETING_IMAGE_BYTES,
): { kind: DetectedFileKind; mime: string } {
  const kind = detectFileKind(buffer);
  if (kind === "pdf") {
    if (buffer.length > maxPdfBytes) {
      throw new Error(`PDF exceeds ${maxPdfBytes} byte limit.`);
    }
    return { kind, mime: "application/pdf" };
  }
  if (kind === "jpeg" || kind === "png" || kind === "webp") {
    if (buffer.length > maxImageBytes) {
      throw new Error(`Image exceeds ${maxImageBytes} byte limit.`);
    }
    const mime = mimeForDetectedKind(kind);
    if (!mime) throw new Error("Unsupported image type.");
    return { kind, mime };
  }
  throw new Error("Unsupported resource file. Use PDF, JPEG, PNG, or WebP.");
}

export async function probeImageDimensions(
  buffer: Buffer,
): Promise<{ width: number; height: number; mimeType: string }> {
  const kind = detectFileKind(buffer);
  const mime = mimeForDetectedKind(kind);
  if (!mime || kind === "pdf") {
    throw new Error("Could not read image dimensions.");
  }
  const sharp = await import("sharp");
  const meta = await sharp.default(buffer).metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Could not read image dimensions.");
  }
  return {
    width: meta.width,
    height: meta.height,
    mimeType: meta.format ? `image/${meta.format}` : mime,
  };
}
