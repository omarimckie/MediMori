import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import {
  createManualFreeResource,
  parseManualResourceForm,
  readResourceFilesFromForm,
} from "@/lib/marketing/manual-upload";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Expected multipart form data.", 400);
  }

  const weeklyPlanId = String(form.get("weeklyPlanId") ?? "").trim();
  if (!weeklyPlanId) return jsonError("weeklyPlanId is required.", 400);

  const store = getMarketingStore();
  const plan = await store.getWeeklyPlan(weeklyPlanId);
  if (!plan) return jsonError("Weekly plan not found.", 404);

  try {
    const parsed = parseManualResourceForm(form);
    const files = await readResourceFilesFromForm(form);
    const result = await createManualFreeResource(store, {
      ...parsed,
      ...files,
      weeklyPlanId,
      campaignId: plan.campaignId,
      actor: auth.username,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    const status = /exceeds|Unsupported|required|Unknown/i.test(message) ? 400 : 500;
    return jsonError(message, status);
  }
}
