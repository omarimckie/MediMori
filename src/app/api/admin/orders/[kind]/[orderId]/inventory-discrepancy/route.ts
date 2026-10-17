import { isAdminAuthenticated } from "@/lib/admin-auth";
import { acknowledgePhysicalInventoryDiscrepancy } from "@/lib/physical-orders";
import { parseOwnerOrderRoute } from "@/lib/order-notifications/order-detail";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ kind: string; orderId: string }> },
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { kind, orderId } = await context.params;
  const route = parseOwnerOrderRoute(kind, orderId);
  if (!route || route.kind !== "physical") {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const result = await acknowledgePhysicalInventoryDiscrepancy(route.orderId);
  if (result === "missing") {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (result === "not_uncertain") {
    return NextResponse.json(
      { error: "This order has no unresolved inventory processing discrepancy." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, inventoryDiscrepancyAcknowledged: true });
}
