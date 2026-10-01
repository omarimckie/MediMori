import type Stripe from "stripe";
import { getPhysicalBook, PHYSICAL_PURCHASE_TYPE, PHYSICAL_SHIPPING_PRICE_CENTS } from "./physical-books";
import { getPhysicalStripePriceId } from "./stripe-physical-prices";

export type PhysicalCheckoutSessionParams = {
  bookId: string;
  quantity: number;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  stripeCustomerId?: string;
  allowPromotionCodes: boolean;
};

export function buildPhysicalCheckoutSessionCreateParams(
  input: PhysicalCheckoutSessionParams,
): Stripe.Checkout.SessionCreateParams {
  const book = getPhysicalBook(input.bookId);
  if (!book) {
    throw new Error("Unsupported physical book.");
  }

  const catalogPriceId = getPhysicalStripePriceId(book);
  if (!catalogPriceId || catalogPriceId !== input.priceId) {
    throw new Error("Physical Stripe price does not match catalog.");
  }

  const customerEmail = input.customerEmail.trim().toLowerCase();

  return {
    mode: "payment",
    line_items: [{ price: input.priceId, quantity: input.quantity }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    ...(input.stripeCustomerId
      ? { customer: input.stripeCustomerId }
      : { customer_email: customerEmail }),
    shipping_address_collection: {
      allowed_countries: ["US"],
    },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: {
            amount: PHYSICAL_SHIPPING_PRICE_CENTS,
            currency: "usd",
          },
          display_name: "Standard US shipping",
          delivery_estimate: {
            minimum: { unit: "business_day", value: 3 },
            maximum: { unit: "business_day", value: 7 },
          },
        },
      },
    ],
    allow_promotion_codes: input.allowPromotionCodes,
    metadata: {
      purchaseType: PHYSICAL_PURCHASE_TYPE,
      bookId: book.id,
      quantity: String(input.quantity),
      customerName: "",
      customerEmail,
    },
  };
}
