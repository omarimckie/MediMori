import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { assertImageUpload, sanitizeUploadFilename } from "@/lib/marketing/file-validation";
import {
  parseSmartUploadFinalizeBody,
  smartUploadErrorStatus,
  validationIssuesFromError,
} from "@/lib/marketing/smart-upload-api";
import {
  finalizeSmartUploadFromBlob,
  finalizeSmartUploadFromBuffer,
} from "@/lib/marketing/smart-upload";
import { AUDIENCES, CONTENT_CATEGORIES, type AudienceId, type ContentCategory } from "@/lib/marketing/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function parseCategory(value: string | undefined): ContentCategory | undefined {
  if (!value) return undefined;
  if (!CONTENT_CATEGORIES.includes(value as ContentCategory)) {
    throw new Error("Unsupported category.");
  }
  return value as ContentCategory;
}

function parseAudience(value: string | undefined): AudienceId | undefined {
  if (!value) return undefined;
  if (!AUDIENCES.includes(value as AudienceId)) {
    throw new Error("Unsupported audience.");
  }
  return value as AudienceId;
}

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  const contentType = request.headers.get("content-type") ?? "";
  const store = getMarketingStore();

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const caption = String(form.get("caption") ?? "").trim();
      const batchId = String(form.get("batchId") ?? "").trim();
      const finalizeKey = String(form.get("finalizeKey") ?? "").trim();
      if (!batchId || !finalizeKey) {
        return jsonError("batchId and finalizeKey are required.", 400);
      }
      const imageEntry = form.get("image");
      if (!(imageEntry instanceof File)) {
        return jsonError("Expected one image file.", 400);
      }
      const buffer = Buffer.from(await imageEntry.arrayBuffer());
      assertImageUpload(buffer);
      const result = await finalizeSmartUploadFromBuffer(store, {
        caption,
        batchId,
        finalizeKey,
        weeklyPlanId: String(form.get("weeklyPlanId") ?? "").trim() || null,
        campaignId: String(form.get("campaignId") ?? "").trim() || null,
        bookId: String(form.get("bookId") ?? "").trim() || null,
        category: parseCategory(String(form.get("category") ?? "").trim() || undefined),
        audience: parseAudience(String(form.get("audience") ?? "").trim() || undefined),
        actor: auth.username,
        imageBuffer: buffer,
        imageFilename: sanitizeUploadFilename(imageEntry.name || "upload.jpg"),
      });
      return NextResponse.json(result);
    }

    let record: Record<string, unknown>;
    try {
      record = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonError("Expected JSON body.", 400);
    }

    const parsed = parseSmartUploadFinalizeBody(record);
    if (!parsed.uploadIntent || !parsed.pathname || !parsed.publicUrl) {
      return jsonError("uploadIntent, pathname, and publicUrl are required for blob finalize.", 400);
    }

    const result = await finalizeSmartUploadFromBlob(store, {
      caption: parsed.caption,
      batchId: parsed.batchId,
      finalizeKey: parsed.finalizeKey,
      weeklyPlanId: parsed.weeklyPlanId,
      campaignId: parsed.campaignId,
      bookId: parsed.bookId,
      category: parseCategory(parsed.category),
      audience: parseAudience(parsed.audience),
      actor: auth.username,
      uploadIntent: parsed.uploadIntent,
      pathname: parsed.pathname,
      publicUrl: parsed.publicUrl,
      imageFilename: parsed.imageFilename,
    });
    return NextResponse.json(result);
  } catch (error) {
    const issues = validationIssuesFromError(error);
    if (issues) {
      return NextResponse.json(
        {
          error: issues.map((item) => item.message).join(" "),
          issues,
        },
        { status: 422 },
      );
    }
    const message = error instanceof Error ? error.message : "Finalize failed.";
    return jsonError(message, smartUploadErrorStatus(message));
  }
}
