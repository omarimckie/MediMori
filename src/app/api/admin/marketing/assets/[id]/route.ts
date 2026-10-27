import { jsonError, requireMarketingAdmin } from "@/lib/marketing/http";
import { getMarketingStore } from "@/lib/marketing/context";
import {
  MarketingAssetUpdateError,
  readReplacementFileFromForm,
  replaceMarketingAssetFile,
  updateMarketingAssetMetadata,
  type MarketingAssetMetadataPatch,
} from "@/lib/marketing/asset-update";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  let body: MarketingAssetMetadataPatch = {};
  try {
    body = (await request.json()) as MarketingAssetMetadataPatch;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  try {
    const asset = await updateMarketingAssetMetadata(getMarketingStore(), id, body);
    return NextResponse.json({ asset });
  } catch (error) {
    if (error instanceof MarketingAssetUpdateError) {
      return jsonError(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Update failed.";
    return jsonError(message, 500);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireMarketingAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Expected multipart form data.", 400);
  }

  const name = String(form.get("name") ?? "").trim();
  const altTextRaw = form.get("altText");
  const altText =
    altTextRaw === null || altTextRaw === undefined
      ? undefined
      : String(altTextRaw);

  try {
    const { buffer, filename } = await readReplacementFileFromForm(form);
    const asset = await replaceMarketingAssetFile(getMarketingStore(), id, buffer, filename, {
      name: name || undefined,
      altText,
    });
    return NextResponse.json({ asset });
  } catch (error) {
    if (error instanceof MarketingAssetUpdateError) {
      return jsonError(error.message, error.status);
    }
    const message = error instanceof Error ? error.message : "Replacement failed.";
    return jsonError(message, 500);
  }
}
