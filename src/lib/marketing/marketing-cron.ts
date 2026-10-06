import { isAdminAuthenticated } from "@/lib/admin-auth";
import { cronAuthDecision, getCronSecret, isProductionRuntime } from "@/lib/marketing/config";
import {
  resolveMarketingDispatcherSource,
  type MarketingDispatcherSource,
} from "@/lib/marketing/reliability/dispatcher-source";
import { recordDispatcherHeartbeat } from "@/lib/marketing/reliability/repository";

export async function authorizeMarketingCron(request: Request) {
  return cronAuthDecision({
    isProduction: isProductionRuntime(),
    cronSecret: getCronSecret(),
    authorizationHeader: request.headers.get("authorization"),
    isAdmin: await isAdminAuthenticated(),
  });
}

export async function recordMarketingPublishDispatcherHeartbeat(input: {
  request: Request;
  auth: { ok: boolean; reason: string };
  publishedCount: number;
}): Promise<MarketingDispatcherSource> {
  if (!input.auth.ok) {
    return "unknown";
  }
  const source = resolveMarketingDispatcherSource(input.request, input.auth);
  await recordDispatcherHeartbeat({
    source,
    publishedCount: input.publishedCount,
    metadata: {
      authReason: input.auth.reason,
    },
  });
  return source;
}
