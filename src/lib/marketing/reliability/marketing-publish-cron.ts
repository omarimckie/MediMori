import type { MarketingStore } from "../store";
import type { MarketingPublication } from "../types";
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
    publishCyclePublications?: MarketingPublication[];
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
  const publishCyclePublications = results.filter(
    (row): row is MarketingPublication =>
      Boolean(row) && typeof row === "object" && typeof (row as MarketingPublication).id === "string",
  );
  await deps.recordHeartbeat({
    request,
    auth,
    publishedCount: results.length,
  });
  const reliability = await deps.runReliabilityAfterMarketingPublish({
    authOk: auth.ok,
    authReason: auth.reason,
    publishCyclePublications,
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
