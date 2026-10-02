import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { validateSmartUploadStagedBlob } from "@/lib/marketing/smart-upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const imageEntry = form.get("image");
      if (!(imageEntry instanceof File)) {
        return jsonError("Expected one image file.", 400);
      }
      const buffer = Buffer.from(await imageEntry.arrayBuffer());
      const { validateSmartUploadImageBytes } = await import("@/lib/marketing/smart-upload");
      const result = await validateSmartUploadImageBytes(buffer);
      if (!result.ok) {
        return NextResponse.json({ ok: false, issues: result.issues }, { status: 422 });
      }
      return NextResponse.json({
        ok: true,
        width: result.truth.width,
        height: result.truth.height,
        mime: result.mime,
        aspectRatio: result.truth.aspectRatio,
      });
    }

    let record: Record<string, unknown>;
    try {
      record = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonError("Expected JSON body.", 400);
    }

    const uploadIntent = String(record.uploadIntent ?? "").trim();
    const pathname = String(record.pathname ?? "").trim();
    const publicUrl = String(record.publicUrl ?? "").trim();
    if (!uploadIntent || !pathname || !publicUrl) {
      return jsonError("uploadIntent, pathname, and publicUrl are required.", 400);
    }

    const result = await validateSmartUploadStagedBlob({
      uploadIntent,
      pathname,
      publicUrl,
      actor: auth.username,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, issues: result.issues }, { status: 422 });
    }
    return NextResponse.json({
      ok: true,
      width: result.truth.width,
      height: result.truth.height,
      mime: result.mime,
      aspectRatio: result.truth.aspectRatio,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Validation failed.";
    const status = /Unauthorized|intent|expired|Invalid preview|not found/i.test(message) ? 400 : 500;
    return jsonError(message, status);
  }
}
