import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { hasMarketingBlobToken } from "@/lib/marketing/marketing-blob";
import { allocateSmartUploadPathname } from "@/lib/marketing/smart-upload";
import { issueSmartUploadIntent } from "@/lib/marketing/smart-upload-intent";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  if (!hasMarketingBlobToken()) {
    return jsonError("Blob client upload is not configured.", 503);
  }

  let record: Record<string, unknown>;
  try {
    record = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Expected JSON body.", 400);
  }

  const filename = String(record.filename ?? "").trim() || "upload.jpg";

  try {
    const pathname = allocateSmartUploadPathname(filename);
    const { uploadIntent, expiresAt } = issueSmartUploadIntent({
      username: auth.username ?? "",
      pathname,
    });
    return NextResponse.json({
      uploadIntent,
      pathname,
      expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create upload intent.";
    return jsonError(message, 500);
  }
}
