export const SHIPPING_CARRIERS = {
  usps: {
    label: "USPS",
    trackingUrl: (trackingNumber: string) =>
      `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingNumber)}`,
  },
  ups: {
    label: "UPS",
    trackingUrl: (trackingNumber: string) =>
      `https://www.ups.com/track?tracknum=${encodeURIComponent(trackingNumber)}`,
  },
  fedex: {
    label: "FedEx",
    trackingUrl: (trackingNumber: string) =>
      `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(trackingNumber)}`,
  },
  dhl: {
    label: "DHL",
    trackingUrl: (trackingNumber: string) =>
      `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encodeURIComponent(trackingNumber)}`,
  },
} as const;

export type ShippingCarrierId = keyof typeof SHIPPING_CARRIERS;

export type ShipmentDetails = {
  carrier: ShippingCarrierId;
  trackingNumber: string;
};

const TRACKING_NUMBER_MAX_LENGTH = 64;

export function shippingCarrierLabel(carrier: string | null | undefined): string | null {
  if (!carrier) return null;
  if (isShippingCarrierId(carrier)) return SHIPPING_CARRIERS[carrier].label;
  return null;
}

export function isShippingCarrierId(value: string): value is ShippingCarrierId {
  return Object.prototype.hasOwnProperty.call(SHIPPING_CARRIERS, value);
}

export function normalizeOptionalTrackingNumber(
  value: unknown,
): { ok: true; trackingNumber: string | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, trackingNumber: null };
  if (typeof value !== "string") {
    return { ok: false, error: "Tracking number must be text." };
  }
  const compact = value.trim().replace(/\s+/g, "");
  if (!compact) return { ok: true, trackingNumber: null };
  if (compact.length > TRACKING_NUMBER_MAX_LENGTH) {
    return { ok: false, error: "Tracking number must be 64 characters or fewer." };
  }
  if (!/^[A-Za-z0-9-]+$/.test(compact)) {
    return {
      ok: false,
      error: "Tracking number can use letters, numbers, and hyphens.",
    };
  }
  return { ok: true, trackingNumber: compact };
}

export function parseShipment(
  body: unknown,
): { ok: true; shipment: ShipmentDetails } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Choose a carrier and enter a tracking number." };
  }
  const record = body as { carrier?: unknown; trackingNumber?: unknown };
  if (typeof record.carrier !== "string" || !isShippingCarrierId(record.carrier)) {
    return { ok: false, error: "Choose USPS, UPS, FedEx, or DHL." };
  }
  const tracking = normalizeOptionalTrackingNumber(record.trackingNumber);
  if (!tracking.ok) return tracking;
  if (!tracking.trackingNumber) {
    return { ok: false, error: "Tracking number is required." };
  }
  return {
    ok: true,
    shipment: { carrier: record.carrier, trackingNumber: tracking.trackingNumber },
  };
}

export function shippingFingerprint(shipment: ShipmentDetails): string {
  return `${shipment.carrier}:${shipment.trackingNumber}`;
}

export type ShippingNoticeErrorCode = "resend_not_configured" | "send_failed";

export type ShippingSaveResult =
  | "saved"
  | "inventory_unresolved"
  | "not_awaiting"
  | "payment_ineligible"
  | "missing";

export type ShippingCorrectionResult =
  | "pending"
  | "already_sent"
  | "in_progress"
  | "payment_ineligible"
  | "not_shipped"
  | "missing";

export type ShippingClaimResult = "claimed" | "already_sent" | "in_progress" | "not_eligible";

export function shippingNoticeLabel(input: {
  status: string | null;
  error: string | null;
}): string | null {
  if (input.status === "sent") return "Customer shipping email delivered.";
  if (input.status === "failed" && input.error === "resend_not_configured") {
    return "Customer shipping email was not sent because email is not configured. Tracking is saved.";
  }
  if (input.status === "failed") {
    return "Customer shipping email failed. Tracking is saved.";
  }
  if (input.status === "sending") return "Customer shipping email is sending.";
  if (input.status === "pending") return "Customer shipping email is waiting to send.";
  return null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type ShippingConfirmationMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export function buildShippingConfirmation(input: {
  to: string;
  customerName: string;
  orderId: string;
  shipment: ShipmentDetails;
}): ShippingConfirmationMessage {
  const carrier = SHIPPING_CARRIERS[input.shipment.carrier];
  const trackingUrl = carrier.trackingUrl(input.shipment.trackingNumber);
  const safeName = escapeHtml(input.customerName);
  const safeOrderId = escapeHtml(input.orderId);
  const safeTracking = escapeHtml(input.shipment.trackingNumber);
  const safeUrl = escapeHtml(trackingUrl);
  const subject = "Your Twilight Feather paperback has shipped";
  const text = [
    `Hi ${input.customerName},`,
    "",
    "Your paperback order has shipped.",
    "",
    `Order number: ${input.orderId}`,
    `Carrier: ${carrier.label}`,
    `Tracking number: ${input.shipment.trackingNumber}`,
    `Track your package: ${trackingUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; max-width: 560px; margin: 0 auto; color: #1a2b4b; line-height: 1.5;">
      <h1 style="font-size: 22px; margin-bottom: 12px;">Your paperback has shipped</h1>
      <p>Hi ${safeName},</p>
      <p><strong>Order number:</strong> ${safeOrderId}</p>
      <p><strong>Carrier:</strong> ${carrier.label}</p>
      <p><strong>Tracking number:</strong> ${safeTracking}</p>
      <p><a href="${safeUrl}">Track your package</a></p>
    </div>
  `;

  return {
    to: input.to,
    subject,
    html,
    text,
    idempotencyKey: `physical-shipping:${input.orderId}:${shippingFingerprint(input.shipment)}`,
  };
}
