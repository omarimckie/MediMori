import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { hasMarketingBlobToken } from "@/lib/marketing/marketing-blob";
import { allocateStagedResourcePathnames } from "@/lib/marketing/resource-client-upload";
import { issueResourceUploadIntent } from "@/lib/marketing/resource-upload-intent";
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

  const previewFilename = String(record.previewFilename ?? "").trim() || "preview.jpg";
  const fileFilename = String(record.fileFilename ?? "").trim() || "resource.pdf";

  try {
    const { previewPathname, filePathname } = allocateStagedResourcePathnames(
      previewFilename,
      fileFilename,
    );
    const { uploadIntent, expiresAt } = issueResourceUploadIntent({
      username: auth.username ?? "",
      previewPathname,
      filePathname,
    });
    return NextResponse.json({
      uploadIntent,
      previewPathname,
      filePathname,
      expiresAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create upload intent.";
    return jsonError(message, 500);
  }
}
