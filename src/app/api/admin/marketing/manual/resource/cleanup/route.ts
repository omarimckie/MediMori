import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { cleanupResourceUploadIntentBlobs } from "@/lib/marketing/manual-upload";
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

  const uploadIntent = String(record.uploadIntent ?? "").trim();
  if (!uploadIntent) {
    return jsonError("uploadIntent is required.", 400);
  }

  try {
    await cleanupResourceUploadIntentBlobs(uploadIntent, auth.username);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup failed.";
    const status = /expired|signature|intent|Unauthorized|match/i.test(message) ? 400 : 500;
    return jsonError(message, status);
  }
}
