import { getMarketingStore } from "@/lib/marketing/context";
import {
  marketingAssetPublicImageResponse,
  resolveMarketingAssetPublicImage,
} from "@/lib/marketing/marketing-asset-public-image";

export const runtime = "nodejs";

async function serveAssetImage(assetId: string, method: "GET" | "HEAD"): Promise<Response> {
  const result = await resolveMarketingAssetPublicImage(getMarketingStore(), assetId, {
    includeBody: method === "GET",
  });
  return marketingAssetPublicImageResponse(result, method);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  return serveAssetImage(assetId, "GET");
}

export async function HEAD(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  return serveAssetImage(assetId, "HEAD");
}
