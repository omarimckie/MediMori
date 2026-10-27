import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import { generateSmartUploadCaptions } from "@/lib/marketing/smart-upload-caption";
import {
  parseSmartUploadGenerateCaptionsBody,
  smartUploadCaptionErrorStatus,
} from "@/lib/marketing/smart-upload-caption-api";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  let record: Record<string, unknown>;
  try {
    record = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Expected JSON body.", 400);
  }

  try {
    const parsed = parseSmartUploadGenerateCaptionsBody(record);
    const store = getMarketingStore();
    const result = await generateSmartUploadCaptions(store, {
      actorUsername: auth.username,
      mode: parsed.mode,
      instructions: parsed.instructions,
      explicitCta: parsed.explicitCta,
      bookId: parsed.bookId,
      campaignId: parsed.campaignId,
      category: parsed.category,
      audience: parsed.audience,
      original: parsed.original,
      acceptedDerivative: parsed.acceptedDerivative,
      finalizeKey: parsed.finalizeKey,
      strategy: parsed.strategy,
      targetRatio: parsed.targetRatio,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Caption generation failed.";
    const status = smartUploadCaptionErrorStatus(error);
    return jsonError(message, status);
  }
}
