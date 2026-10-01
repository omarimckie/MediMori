import { normalizeEmail } from "./checkout-ownership";
import type Stripe from "stripe";

function escapeStripeSearchValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Finds an existing Stripe Customer for the normalized email or creates one.
 * Stripe does not guarantee global email uniqueness; search-then-create is not atomic.
 * Concurrent signups or checkouts may create duplicate customers — Phase 2/3 should reconcile.
 */
export async function findOrCreateStripeCustomerByEmail(
  stripe: Stripe,
  email: string,
): Promise<string> {
  const normalized = normalizeEmail(email);
  const escaped = escapeStripeSearchValue(normalized);
  const found = await stripe.customers.search({
    query: `email:'${escaped}'`,
    limit: 1,
  });
  const existing = found.data[0];
  if (existing?.id) {
    return existing.id;
  }

  const created = await stripe.customers.create({ email: normalized });
  return created.id;
}
