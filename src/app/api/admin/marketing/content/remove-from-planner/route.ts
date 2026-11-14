import { jsonError, requireMarketingAdminMutation } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import {
  removeContentFromPlanner,
  removeFromPlannerErrorStatus,
  RemoveFromPlannerError,
} from "@/lib/marketing/content-planner-queue";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdminMutation();
  if (!auth.ok) return auth.response;

  let body: { contentIds?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const rawIds = body.contentIds;
  if (!Array.isArray(rawIds)) {
    return jsonError("contentIds must be an array.", 400);
  }
  const contentIds = rawIds.filter((id): id is string => typeof id === "string");

  try {
    const result = await removeContentFromPlanner(getMarketingStore(), { contentIds });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof RemoveFromPlannerError) {
      return jsonError(error.message, removeFromPlannerErrorStatus(error));
    }
    const message = error instanceof Error ? error.message : "Remove from planner failed.";
    return jsonError(message, 500);
  }
}
