import { requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import {
  marketingAdminAssetImageResponse,
  resolveMarketingAdminAssetImage,
} from "@/lib/marketing/marketing-admin-asset-image";
export const runtime = "nodejs";

async function serveAdminAssetImage(
  assetId: string,
  method: "GET" | "HEAD",
): Promise<Response> {
  const result = await resolveMarketingAdminAssetImage(getMarketingStore(), assetId, {
    includeBody: method === "GET",
  });
  return marketingAdminAssetImageResponse(result, method);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  return serveAdminAssetImage(id, "GET");
}

export async function HEAD(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  return serveAdminAssetImage(id, "HEAD");
}
