import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { parseSmartUploadDiscardPreviewBody, smartUploadErrorStatus } from "@/lib/marketing/smart-upload-api";
import { discardSmartUploadPreviewDerivative } from "@/lib/marketing/smart-upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  try {
    let record: Record<string, unknown>;
    try {
      record = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonError("Expected JSON body.", 400);
    }

    const preview = parseSmartUploadDiscardPreviewBody(record);
    await discardSmartUploadPreviewDerivative({
      actor: auth.username,
      preview,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discard preview failed.";
    const status = smartUploadErrorStatus(message);
    return jsonError(message, status);
  }
}
