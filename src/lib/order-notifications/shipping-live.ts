import { sendPhysicalShippingConfirmationEmail } from "@/lib/email";
import {
  claimPhysicalShippingNotice,
  correctPhysicalShipment,
  getPhysicalOrderById,
  markPhysicalOrderShipped,
  markPhysicalShippingNoticeFailed,
  markPhysicalShippingNoticeSent,
} from "@/lib/physical-orders";
import type { ShippingConfirmationDeps } from "./shipping-confirmation";

export function liveShippingDeps(): ShippingConfirmationDeps {
  return {
    getOrder: getPhysicalOrderById,
    saveInitial: markPhysicalOrderShipped,
    saveCorrection: correctPhysicalShipment,
    claim: claimPhysicalShippingNotice,
    markSent: markPhysicalShippingNoticeSent,
    markFailed: markPhysicalShippingNoticeFailed,
    send: sendPhysicalShippingConfirmationEmail,
  };
}
