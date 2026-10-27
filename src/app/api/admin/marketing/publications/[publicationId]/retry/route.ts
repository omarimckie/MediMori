import { getMarketingStore } from "@/lib/marketing/context";
import { requireMarketingAdmin } from "@/lib/marketing/http";
import { handleAdminPublicationRetryRequest } from "@/lib/marketing/publication-retry-http";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ publicationId: string }> },
) {
  const auth = await requireMarketingAdmin();
  const { publicationId } = await context.params;
  return handleAdminPublicationRetryRequest({
    publicationId,
    auth,
    store: getMarketingStore(),
  });
}
