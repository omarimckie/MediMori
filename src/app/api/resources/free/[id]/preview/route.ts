import { getMarketingStore } from "@/lib/marketing/context";
import { handleFreeResourcePreviewRequest } from "@/lib/marketing/resource-preview";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleFreeResourcePreviewRequest(getMarketingStore(), id);
}
