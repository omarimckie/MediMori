import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { hasMarketingBlobToken } from "@/lib/marketing/marketing-blob";
import { smartUploadClientUploadTokenConstraints } from "@/lib/marketing/smart-client-upload";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return jsonError("Invalid upload request.", 400);
  }

  let blobTokenAdmin: string | null = null;
  if (body.type === "blob.generate-client-token") {
    const auth = await requireMarketingAdmin();
    if (!auth.ok) return auth.response;
    blobTokenAdmin = auth.username;
  }

  if (!hasMarketingBlobToken()) {
    return jsonError("Blob client upload is not configured.", 503);
  }

  try {
    const jsonResponse = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) =>
        smartUploadClientUploadTokenConstraints(pathname, clientPayload, blobTokenAdmin),
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Blob upload authorization failed.";
    const status = /Unauthorized/i.test(message) ? 401 : 400;
    return jsonError(message, status);
  }
}
