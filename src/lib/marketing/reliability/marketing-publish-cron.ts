import type { MarketingStore } from "../store";
import type { ReliabilitySweepResult } from "./sweep";

export type MarketingPublishCronAuth = { ok: boolean; reason: string };

export type MarketingPublishCronResult =
  | { ok: false; status: 401; body: { error: string } }
  | {
      ok: true;
      status: 200;
      body: {
        published: number;
        results: unknown[];
        reliability?: ReliabilitySweepResult;
      };
    };

export type MarketingPublishCronDeps = {
  authorize: (request: Request) => Promise<MarketingPublishCronAuth>;
  getStore: () => MarketingStore;
  publishDue: (store: MarketingStore) => Promise<unknown[]>;
  recordHeartbeat: (input: {
    request: Request;
    auth: MarketingPublishCronAuth;
    publishedCount: number;
  }) => Promise<unknown>;
  runReliabilityAfterMarketingPublish: (input: {
    authOk: boolean;
    authReason: string;
  }) => Promise<ReliabilitySweepResult | null>;
};

export async function handleMarketingPublishCron(
  request: Request,
  deps: MarketingPublishCronDeps,
): Promise<MarketingPublishCronResult> {
  const auth = await deps.authorize(request);
  if (!auth.ok) {
    return { ok: false, status: 401, body: { error: "Unauthorized." } };
  }
  const results = await deps.publishDue(deps.getStore());
  await deps.recordHeartbeat({
    request,
    auth,
    publishedCount: results.length,
  });
  const reliability = await deps.runReliabilityAfterMarketingPublish({
    authOk: auth.ok,
    authReason: auth.reason,
  });
  return {
    ok: true,
    status: 200,
    body: {
      published: results.length,
      results,
      ...(reliability ? { reliability } : {}),
    },
  };
}
