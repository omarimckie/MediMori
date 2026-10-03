import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { parseSmartUploadPreviewFixBody, smartUploadErrorStatus } from "@/lib/marketing/smart-upload-api";
import { generateSmartUploadPreviewFix } from "@/lib/marketing/smart-upload";
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

    const parsed = parseSmartUploadPreviewFixBody(record);
    const preview = await generateSmartUploadPreviewFix({
      actor: auth.username,
      finalizeKey: parsed.finalizeKey,
      original: parsed.original,
      strategy: parsed.strategy,
      targetRatio: parsed.targetRatio,
      imageFilename: parsed.imageFilename,
    });

    return NextResponse.json({ ok: true, preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview fix failed.";
    const status = smartUploadErrorStatus(message);
    return jsonError(message, status);
  }
}
