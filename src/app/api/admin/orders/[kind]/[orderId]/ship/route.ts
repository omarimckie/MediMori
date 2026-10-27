import { isAdminAuthenticated } from "@/lib/admin-auth";
import { liveShippingDeps } from "@/lib/order-notifications/shipping-live";
import { handlePhysicalShipment } from "@/lib/order-notifications/shipping-confirmation";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ kind: string; orderId: string }> },
) {
  const { kind, orderId } = await context.params;
  const result = await handlePhysicalShipment({
    isAdmin: await isAdminAuthenticated(),
    kind,
    orderId,
    action: "ship",
    body: await readJson(request),
    deps: liveShippingDeps(),
  });
  return NextResponse.json(result.body, { status: result.status });
}
