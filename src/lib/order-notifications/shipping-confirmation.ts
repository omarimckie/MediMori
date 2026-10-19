import type { PhysicalOrderRow } from "@/lib/physical-orders";
import { parseOwnerOrderRoute } from "./order-detail";
import {
  buildShippingConfirmation,
  parseShipment,
  shippingFingerprint,
  type ShipmentDetails,
  type ShippingClaimResult,
  type ShippingConfirmationMessage,
  type ShippingCorrectionResult,
  type ShippingNoticeErrorCode,
  type ShippingSaveResult,
} from "./shipping-carriers";

export type { ShippingClaimResult, ShippingCorrectionResult, ShippingSaveResult };

export type ShippingConfirmationDeps = {
  getOrder(orderId: string): Promise<PhysicalOrderRow | null>;
  saveInitial(orderId: string, shipment: ShipmentDetails): Promise<ShippingSaveResult>;
  saveCorrection(orderId: string, shipment: ShipmentDetails): Promise<ShippingCorrectionResult>;
  claim(orderId: string, shipment: ShipmentDetails): Promise<ShippingClaimResult>;
  markSent(orderId: string, shipment: ShipmentDetails): Promise<void>;
  markFailed(orderId: string, code: ShippingNoticeErrorCode): Promise<void>;
  send(message: ShippingConfirmationMessage): Promise<void>;
};

export type ShipmentHttpResult = {
  status: number;
  body: {
    ok?: boolean;
    error?: string;
    customerEmail?: "delivered" | "already_delivered" | "failed" | "in_progress";
    emailError?: ShippingNoticeErrorCode;
    carrier?: ShipmentDetails["carrier"];
    trackingNumber?: string;
    fulfillmentStatus?: "Shipped";
  };
};

const PAYMENT_BLOCK =
  "This order cannot be shipped because payment is not confirmed as paid.";

export function shippingNoticeErrorCode(error: unknown): ShippingNoticeErrorCode {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "resend_not_configured"
  ) {
    return "resend_not_configured";
  }
  return "send_failed";
}

export async function handlePhysicalShipment(input: {
  isAdmin: boolean;
  kind: string;
  orderId: string;
  action: "ship" | "correct" | "retry";
  body: unknown;
  deps: ShippingConfirmationDeps;
}): Promise<ShipmentHttpResult> {
  if (!input.isAdmin) {
    return { status: 401, body: { error: "Unauthorized." } };
  }

  const route = parseOwnerOrderRoute(input.kind, input.orderId);
  if (!route || route.kind !== "physical") {
    return { status: 404, body: { error: "Order not found." } };
  }

  let shipment: ShipmentDetails;
  if (input.action === "retry") {
    const order = await input.deps.getOrder(route.orderId);
    if (!order) return { status: 404, body: { error: "Order not found." } };
    if (order.paymentStatus !== "paid") {
      return { status: 409, body: { error: PAYMENT_BLOCK } };
    }
    if (order.fulfillmentStatus !== "shipped") {
      return { status: 409, body: { error: "This order is not shipped." } };
    }
    const parsed = parseShipment({
      carrier: order.carrier,
      trackingNumber: order.trackingNumber,
    });
    if (!parsed.ok) {
      return {
        status: 409,
        body: { error: "Saved carrier and tracking number are incomplete." },
      };
    }
    shipment = parsed.shipment;
  } else {
    const parsed = parseShipment(input.body);
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
    shipment = parsed.shipment;
    if (input.action === "ship") {
      const saved = await input.deps.saveInitial(route.orderId, shipment);
      if (saved !== "saved") {
        if (saved === "not_awaiting") {
          const existing = await input.deps.getOrder(route.orderId);
          if (
            existing?.shippingNoticeSentFingerprint === shippingFingerprint(shipment) &&
            existing.carrier === shipment.carrier &&
            existing.trackingNumber === shipment.trackingNumber
          ) {
            return alreadyDelivered(shipment);
          }
        }
        return shipmentSaveError(saved);
      }
    } else {
      const corrected = await input.deps.saveCorrection(route.orderId, shipment);
      if (corrected === "already_sent") return alreadyDelivered(shipment);
      if (corrected === "in_progress") return inProgress(shipment);
      if (corrected !== "pending") return correctionError(corrected);
    }
  }

  const claimed = await input.deps.claim(route.orderId, shipment);
  if (claimed === "already_sent") return alreadyDelivered(shipment);
  if (claimed === "in_progress") return inProgress(shipment);
  if (claimed !== "claimed") {
    return {
      status: 409,
      body: { error: "Customer email cannot be sent for this order." },
    };
  }

  const order = await input.deps.getOrder(route.orderId);
  if (!order || !order.customerEmail.trim()) {
    await input.deps.markFailed(route.orderId, "send_failed");
    return failedDelivery(shipment, "send_failed");
  }

  try {
    await input.deps.send(
      buildShippingConfirmation({
        to: order.customerEmail,
        customerName: order.customerName,
        orderId: order.id,
        shipment,
      }),
    );
    await input.deps.markSent(route.orderId, shipment);
    return {
      status: 200,
      body: {
        ok: true,
        customerEmail: "delivered",
        carrier: shipment.carrier,
        trackingNumber: shipment.trackingNumber,
        fulfillmentStatus: "Shipped",
      },
    };
  } catch (error) {
    const emailError = shippingNoticeErrorCode(error);
    await input.deps.markFailed(route.orderId, emailError);
    return failedDelivery(shipment, emailError);
  }
}

function shipmentSaveError(result: Exclude<ShippingSaveResult, "saved">): ShipmentHttpResult {
  if (result === "missing") return { status: 404, body: { error: "Order not found." } };
  if (result === "inventory_unresolved") {
    return {
      status: 409,
      body: {
        error: "Acknowledge the inventory discrepancy before marking this order shipped.",
      },
    };
  }
  if (result === "payment_ineligible") return { status: 409, body: { error: PAYMENT_BLOCK } };
  return { status: 409, body: { error: "This order is not awaiting shipment." } };
}

function correctionError(
  result: Exclude<ShippingCorrectionResult, "pending" | "already_sent" | "in_progress">,
): ShipmentHttpResult {
  if (result === "missing") return { status: 404, body: { error: "Order not found." } };
  if (result === "payment_ineligible") return { status: 409, body: { error: PAYMENT_BLOCK } };
  return { status: 409, body: { error: "Tracking can be corrected after the order is marked shipped." } };
}

function alreadyDelivered(shipment: ShipmentDetails): ShipmentHttpResult {
  return {
    status: 200,
    body: {
      ok: true,
      customerEmail: "already_delivered",
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      fulfillmentStatus: "Shipped",
    },
  };
}

function inProgress(shipment: ShipmentDetails): ShipmentHttpResult {
  return {
    status: 202,
    body: {
      ok: true,
      customerEmail: "in_progress",
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      fulfillmentStatus: "Shipped",
    },
  };
}

function failedDelivery(
  shipment: ShipmentDetails,
  emailError: ShippingNoticeErrorCode,
): ShipmentHttpResult {
  return {
    status: 200,
    body: {
      ok: true,
      customerEmail: "failed",
      emailError,
      carrier: shipment.carrier,
      trackingNumber: shipment.trackingNumber,
      fulfillmentStatus: "Shipped",
    },
  };
}
