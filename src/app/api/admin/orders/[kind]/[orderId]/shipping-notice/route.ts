import { isAdminAuthenticated } from "@/lib/admin-auth";
import { liveShippingDeps } from "@/lib/order-notifications/shipping-live";
import { handlePhysicalShipment } from "@/lib/order-notifications/shipping-confirmation";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ kind: string; orderId: string }> },
) {
  const { kind, orderId } = await context.params;
  const result = await handlePhysicalShipment({
    isAdmin: await isAdminAuthenticated(),
    kind,
    orderId,
    action: "retry",
    body: null,
    deps: liveShippingDeps(),
  });
  return NextResponse.json(result.body, { status: result.status });
}
