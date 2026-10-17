import { isAdminAuthenticated } from "@/lib/admin-auth";
import { markPhysicalOrderShipped } from "@/lib/physical-orders";
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

  const result = await markPhysicalOrderShipped(route.orderId);
  if (result === "missing") {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (result === "inventory_unresolved") {
    return NextResponse.json(
      { error: "Acknowledge the inventory discrepancy before marking this order shipped." },
      { status: 409 },
    );
  }
  if (result === "not_awaiting") {
    return NextResponse.json(
      { error: "This order is not awaiting shipment." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, fulfillmentStatus: "Shipped" });
}
