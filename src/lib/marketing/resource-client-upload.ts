import {
  isMarketingPrivateResourceFilePathname,
  isMarketingPublicResourcePreviewPathname,
} from "./marketing-blob";
import { MAX_MARKETING_IMAGE_BYTES, MAX_MARKETING_PDF_BYTES } from "./file-validation";
import { verifyResourceUploadIntentForBlobToken } from "./resource-upload-intent";

export type ResourceClientUploadRole = "preview" | "file";

const PREVIEW_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];
const FILE_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];

export type ResourceClientUploadPayload = {
  role: ResourceClientUploadRole;
  uploadIntent: string;
};

export function parseResourceClientUploadPayload(
  clientPayload: string | null,
): ResourceClientUploadPayload {
  if (!clientPayload?.trim()) {
    throw new Error("Missing upload payload.");
  }
  try {
    const parsed = JSON.parse(clientPayload) as { role?: string; uploadIntent?: string };
    if (parsed.role !== "preview" && parsed.role !== "file") {
      throw new Error("Invalid upload role.");
    }
    const uploadIntent = String(parsed.uploadIntent ?? "").trim();
    if (!uploadIntent) {
      throw new Error("Missing upload intent.");
    }
    return { role: parsed.role, uploadIntent };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Missing")) {
      throw error;
    }
    if (error instanceof Error && error.message.startsWith("Invalid")) {
      throw error;
    }
    throw new Error("Invalid upload payload.");
  }
}

export function parseResourceClientUploadRole(clientPayload: string | null): ResourceClientUploadRole {
  return parseResourceClientUploadPayload(clientPayload).role;
}

export function allocateStagedResourcePathnames(
  previewFilename: string,
  fileFilename: string,
): { previewPathname: string; filePathname: string } {
  return {
    previewPathname: buildResourceBlobPathname("preview", previewFilename),
    filePathname: buildResourceBlobPathname("file", fileFilename),
  };
}

export function buildResourceBlobPathname(role: ResourceClientUploadRole, filename: string): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  const lower = filename.toLowerCase();
  let ext = role === "preview" ? ".jpg" : ".pdf";
  if (lower.endsWith(".pdf")) ext = ".pdf";
  else if (lower.endsWith(".png")) ext = ".png";
  else if (lower.endsWith(".webp")) ext = ".webp";
  else if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) ext = ".jpg";
  const base = role === "preview" ? "marketing/public" : "marketing/private";
  return `${base}/${id}${ext}`;
}

export function resourceClientUploadTokenConstraints(
  pathname: string,
  clientPayload: string | null,
  adminUsername: string | null,
): {
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
  addRandomSuffix: false;
} {
  const { role, uploadIntent } = parseResourceClientUploadPayload(clientPayload);
  verifyResourceUploadIntentForBlobToken(uploadIntent, adminUsername, pathname, role);
  if (role === "preview") {
    if (!isMarketingPublicResourcePreviewPathname(pathname)) {
      throw new Error("Invalid preview upload pathname.");
    }
    return {
      allowedContentTypes: PREVIEW_CONTENT_TYPES,
      maximumSizeInBytes: MAX_MARKETING_IMAGE_BYTES,
      addRandomSuffix: false,
    };
  }
  if (!isMarketingPrivateResourceFilePathname(pathname)) {
    throw new Error("Invalid downloadable file upload pathname.");
  }
  return {
    allowedContentTypes: FILE_CONTENT_TYPES,
    maximumSizeInBytes: MAX_MARKETING_PDF_BYTES,
    addRandomSuffix: false,
  };
}
