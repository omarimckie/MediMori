import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import {
  resolveSmartUploadStagedImage,
  smartUploadStagedImageErrorStatus,
  smartUploadStagedImageResponse,
} from "@/lib/marketing/smart-upload-staged-image";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const pathname = url.searchParams.get("pathname") ?? "";
  const uploadIntent = url.searchParams.get("uploadIntent") ?? "";

  try {
    const result = await resolveSmartUploadStagedImage(
      pathname,
      uploadIntent,
      auth.username,
    );
    return smartUploadStagedImageResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Not found.";
    const status = smartUploadStagedImageErrorStatus(message);
    if (status === 404) {
      return new Response(JSON.stringify({ error: "Not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return jsonError(
      status === 401 ? "Unauthorized." : "Invalid staged image request.",
      status,
    );
  }
}
