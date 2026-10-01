import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("checkout routes reuse Stripe Customer helper", () => {
  const ebookRoute = readFileSync(
    new URL("../app/api/checkout/route.ts", import.meta.url),
    "utf8",
  );
  const physicalRoute = readFileSync(
    new URL("../app/api/checkout/physical/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(ebookRoute, /findOrCreateStripeCustomerByEmail/);
  assert.match(physicalRoute, /findOrCreateStripeCustomerByEmail/);
  assert.match(ebookRoute, /customer: stripeCustomerId/);
});
