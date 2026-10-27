import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import {
  createManualFreeResource,
  createManualFreeResourceFromStagedBlobs,
  parseManualResourceForm,
  parseManualResourceMetadataRecord,
  parseManualResourceStagedBlobBody,
  readResourceFilesFromForm,
} from "@/lib/marketing/manual-upload";
import { verifyResourceUploadIntentForRegistration } from "@/lib/marketing/resource-upload-intent";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    let record: Record<string, unknown>;
    try {
      record = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonError("Expected JSON body.", 400);
    }

    const weeklyPlanId = String(record.weeklyPlanId ?? "").trim();
    if (!weeklyPlanId) return jsonError("weeklyPlanId is required.", 400);

    const store = getMarketingStore();
    const plan = await store.getWeeklyPlan(weeklyPlanId);
    if (!plan) return jsonError("Weekly plan not found.", 404);

    const uploadIntent = String(record.uploadIntent ?? "").trim();
    if (!uploadIntent) return jsonError("uploadIntent is required.", 400);

    try {
      const parsed = parseManualResourceMetadataRecord(record);
      const staged = parseManualResourceStagedBlobBody(record);
      verifyResourceUploadIntentForRegistration(
        uploadIntent,
        auth.username,
        staged.previewPathname,
        staged.filePathname,
      );
      const result = await createManualFreeResourceFromStagedBlobs(store, {
        ...parsed,
        ...staged,
        weeklyPlanId,
        campaignId: plan.campaignId,
        actor: auth.username,
      });
      return NextResponse.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      const status = /exceeds|Unsupported|required|Unknown|Invalid|not found|intent|expired|signature|Unauthorized|match/i.test(
          message,
        )
        ? 400
        : 500;
      return jsonError(message, status);
    }
  }

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
