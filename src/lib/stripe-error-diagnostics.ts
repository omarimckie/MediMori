import Stripe from "stripe";

export type StripeErrorDiagnostics = {
  type?: string;
  code?: string;
  statusCode?: number;
  param?: string;
  message: string;
};

/** Safe Stripe error fields for logs (no secrets or payment details). */
export function stripeErrorDiagnostics(error: unknown): StripeErrorDiagnostics {
  if (error instanceof Stripe.errors.StripeError) {
    return {
      type: error.rawType ?? error.type,
      code: error.code,
      statusCode: error.statusCode,
      param: error.param ?? undefined,
      message: error.message,
    };
  }
  return {
    message: error instanceof Error ? error.message : "unknown",
  };
}
