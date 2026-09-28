import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { hasMarketingBlobToken } from "@/lib/marketing/marketing-blob";
import {
  assertResourceUploadUrlAuthorized,
  createResourcePutPresignedUrl,
  parseResourceUploadUrlBody,
} from "@/lib/marketing/resource-presigned-put";
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
    const { uploadIntent, pathname, role } = parseResourceUploadUrlBody(record);
    assertResourceUploadUrlAuthorized(uploadIntent, pathname, role, auth.username);
    const issued = await createResourcePutPresignedUrl({ pathname, role });
    const body: Record<string, unknown> = {
      presignedUrl: issued.presignedUrl,
      pathname: issued.pathname,
      expiresAt: issued.validUntil,
    };
    if (issued.publicUrl) {
      body.publicUrl = issued.publicUrl;
    }
    return NextResponse.json(body);
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
