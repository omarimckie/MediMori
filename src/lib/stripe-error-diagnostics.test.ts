import assert from "node:assert/strict";
import { test } from "node:test";
import Stripe from "stripe";
import { stripeErrorDiagnostics } from "./stripe-error-diagnostics";

test("stripeErrorDiagnostics extracts Stripe error fields", () => {
  const error = new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    message: "An active promotion code with `TWILIGHTFEATHER10` already exists.",
    param: "code",
    code: "resource_already_exists",
    statusCode: 400,
  });

  const diagnostics = stripeErrorDiagnostics(error);
  assert.equal(diagnostics.type, "invalid_request_error");
  assert.equal(diagnostics.code, "resource_already_exists");
  assert.equal(diagnostics.statusCode, 400);
  assert.equal(diagnostics.param, "code");
  assert.match(diagnostics.message, /TWILIGHTFEATHER10/);
});

test("stripeErrorDiagnostics falls back for unknown errors", () => {
  assert.deepEqual(stripeErrorDiagnostics(new Error("boom")), {
    message: "boom",
  });
});
