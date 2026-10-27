import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyBroadcastDeliveryResult,
  isDeliveryClaimsSchemaUnavailableError,
} from "./morning-brief-delivery-classification";

test("classifyBroadcastDeliveryResult distinguishes acceptance vs zero delivery", () => {
  assert.equal(
    classifyBroadcastDeliveryResult({
      notification: {
        id: "n",
        type: "morning_brief",
        severity: "info",
        title: "t",
        body: "b",
        destination: "/admin/marketing",
        relatedContentId: null,
        relatedPublicationId: null,
        relatedIncidentId: null,
        deliveryStatus: "delivered",
        deliveryAttemptedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        readAt: null,
      },
      pushAttempted: 2,
      pushDelivered: 1,
    }),
    "confirmed_provider_acceptance",
  );
  assert.equal(
    classifyBroadcastDeliveryResult({
      notification: {
        id: "n",
        type: "morning_brief",
        severity: "info",
        title: "t",
        body: "b",
        destination: "/admin/marketing",
        relatedContentId: null,
        relatedPublicationId: null,
        relatedIncidentId: null,
        deliveryStatus: "failed",
        deliveryAttemptedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        readAt: null,
      },
      pushAttempted: 1,
      pushDelivered: 0,
    }),
    "definitive_zero_delivery",
  );
});

test("isDeliveryClaimsSchemaUnavailableError detects missing claims table", () => {
  assert.equal(
    isDeliveryClaimsSchemaUnavailableError(
      Object.assign(new Error('relation "marketing_morning_brief_delivery_claims" does not exist'), {
        code: "42P01",
      }),
    ),
    true,
  );
  assert.equal(isDeliveryClaimsSchemaUnavailableError(new Error("other")), false);
});
