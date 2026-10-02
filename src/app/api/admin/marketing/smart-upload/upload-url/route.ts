import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { hasMarketingBlobToken } from "@/lib/marketing/marketing-blob";
import {
  assertSmartUploadUrlAuthorized,
  createSmartUploadPutPresignedUrl,
  parseSmartUploadUrlBody,
} from "@/lib/marketing/smart-presigned-put";
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

  try {
    const { uploadIntent, pathname } = parseSmartUploadUrlBody(record);
    assertSmartUploadUrlAuthorized(uploadIntent, pathname, auth.username);
    const issued = await createSmartUploadPutPresignedUrl({ pathname });
    return NextResponse.json({
      presignedUrl: issued.presignedUrl,
      pathname: issued.pathname,
      publicUrl: issued.publicUrl,
      expiresAt: issued.validUntil,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create upload URL.";
    const status = /Unauthorized|intent|expired|signature|match|Invalid|required/i.test(message)
      ? 400
      : /not configured/i.test(message)
        ? 503
        : 500;
    return jsonError(message, status);
  }
}
