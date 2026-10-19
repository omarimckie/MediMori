import { getAuthenticatedAdminUsername, isAdminAuthenticated } from "@/lib/admin-auth";
import { parseOwnerOrderRoute } from "@/lib/order-notifications/order-detail";
import { deliverOneFailedOwnerPush } from "@/lib/order-notifications/owner-push-live";
import {
  findExhaustedOwnerPushForOrder,
  recoverExhaustedOwnerPushJob,
} from "@/lib/order-notifications/repository";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ kind: string; orderId: string }> },
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const adminUsername = await getAuthenticatedAdminUsername();
  if (!adminUsername) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { kind, orderId } = await context.params;
  const route = parseOwnerOrderRoute(kind, orderId);
  if (!route) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  let reason = "";
  try {
    const body = (await request.json()) as { reason?: unknown };
    reason = typeof body.reason === "string" ? body.reason.trim() : "";
  } catch {
    reason = "";
  }
  if (!reason || reason.length > 500) {
    return NextResponse.json(
      { error: "A recovery reason of 500 characters or fewer is required." },
      { status: 400 },
    );
  }

  const exhausted = await findExhaustedOwnerPushForOrder(route.kind, route.orderId);
  if (!exhausted) {
    return NextResponse.json(
      { error: "This order has no exhausted notification to recover." },
      { status: 409 },
    );
  }

  const granted = await recoverExhaustedOwnerPushJob({
    jobId: exhausted.id,
    adminUsername,
    reason,
  });
  if (!granted) {
    return NextResponse.json(
      { error: "This notification was already recovered." },
      { status: 409 },
    );
  }

  const delivery = await deliverOneFailedOwnerPush(granted.jobId);
  return NextResponse.json({
    ok: true,
    delivery,
    priorAttemptCount: granted.priorAttemptCount,
    maxAttempts: granted.maxAttempts,
  });
}
