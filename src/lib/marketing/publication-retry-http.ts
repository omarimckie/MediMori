import { NextResponse } from "next/server";
import type { requireMarketingAdmin } from "./http";
import { retryFailedInstagramPublication } from "./publication-retry";
import type { MarketingStore } from "./store";

type AdminAuth = Awaited<ReturnType<typeof requireMarketingAdmin>>;

export async function handleAdminPublicationRetryRequest(input: {
  publicationId: string;
  auth: AdminAuth;
  store: MarketingStore;
}) {
  if (!input.auth.ok) return input.auth.response;
  const { status, body } = await retryFailedInstagramPublication(
    input.store,
    input.publicationId,
  );
  return NextResponse.json(body, { status });
}
