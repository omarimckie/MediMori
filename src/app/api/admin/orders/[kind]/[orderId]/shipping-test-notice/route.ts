import { isAdminAuthenticated } from "@/lib/admin-auth";
import { sendPhysicalShippingConfirmationEmail } from "@/lib/email";
import { getPhysicalOrderById } from "@/lib/physical-orders";
import {
  createPostgresShippingTestClaimStore,
  handleShippingTestEmail,
  isShippingTestEmailEnabled,
  isShippingTestEmailSendArmed,
  type ShippingTestClaimStore,
} from "@/lib/order-notifications/shipping-test-notice";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function discardBody(request: Request): Promise<void> {
  try {
    await request.json();
  } catch {
    // The test action accepts no recipient, carrier, or tracking input.
  }
}

function postgresClaims(): ShippingTestClaimStore {
  return {
    tryClaim(orderId) {
      return createPostgresShippingTestClaimStore().tryClaim(orderId);
    },
    complete(orderId, status) {
      return createPostgresShippingTestClaimStore().complete(orderId, status);
    },
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ kind: string; orderId: string }> },
) {
  await discardBody(request);
  const { kind, orderId } = await context.params;
  const result = await handleShippingTestEmail({
    isAdmin: await isAdminAuthenticated(),
    featureEnabled: isShippingTestEmailEnabled(),
    sendArmed: isShippingTestEmailSendArmed(),
    kind,
    orderId,
    getOrder: getPhysicalOrderById,
    claims: postgresClaims(),
    send: sendPhysicalShippingConfirmationEmail,
  });
  return NextResponse.json(result.body, { status: result.status });
}
