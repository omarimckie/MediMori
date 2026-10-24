import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { engineeringAdminGetTaskHistoryResponse } from "./admin-engineering-get-handler";

const taskId = "79a4f5e2-0565-41c3-9503-5eb6678cf890";
const secret = "postgres://worker:secret-token@db.example/neondb";

test("engineering admin task history rejects unauthenticated callers", async () => {
  const response = await engineeringAdminGetTaskHistoryResponse(
    new Request(`http://localhost/api/admin/engineering?id=${taskId}`),
    {
      isAuthenticated: async () => false,
      controlPlaneEnabled: true,
      getTaskHistory: async () => ({ events: [] }),
    },
  );
  assert.equal(response.status, 401);
});

test("engineering admin task history projects block diagnostics without cleanup arrays or secrets", async () => {
  const response = await engineeringAdminGetTaskHistoryResponse(
    new Request(`http://localhost/api/admin/engineering?id=${taskId}`),
    {
      isAuthenticated: async () => true,
      controlPlaneEnabled: true,
      getTaskHistory: async () => ({
        events: [{
          id: randomUUID(),
          actor: "worker",
          action: "block",
          created_at: "2026-10-23T00:00:00.000Z",
          details: {
            diagnostic: {
              stage: "implementation",
              code: "proposal_invalid_json",
              operation: "apply_proposal",
              category: "proposal_failure",
              cleanupOutcome: "failed",
              cleanupFailures: [{ resourceType: "source-volume", category: "resource_in_use" }],
              message: secret,
              stack: "internal-stack",
              operationForged: "merge_main",
            },
            internalRecord: { token: secret },
          },
        }],
      }),
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { events: Array<{ details: Record<string, unknown> }> };
  const diagnostic = (body.events[0].details.diagnostic ?? {}) as Record<string, unknown>;
  assert.equal(diagnostic.code, "proposal_invalid_json");
  assert.equal(diagnostic.stage, "implementation");
  assert.equal(diagnostic.operation, "apply_proposal");
  assert.equal(diagnostic.category, "proposal_failure");
  assert.equal(diagnostic.cleanupOutcome, "failed");
  assert.equal(diagnostic.cleanupFailures, undefined);
  const encoded = JSON.stringify(body);
  assert.equal(encoded.includes("secret-token"), false);
  assert.equal(encoded.includes("internal-stack"), false);
  assert.equal(encoded.includes("internalRecord"), false);
  assert.equal(encoded.includes("merge_main"), false);
});

test("engineering admin task history omits invalid diagnostic classifications independently", async () => {
  const response = await engineeringAdminGetTaskHistoryResponse(
    new Request(`http://localhost/api/admin/engineering?id=${taskId}`),
    {
      isAuthenticated: async () => true,
      controlPlaneEnabled: true,
      getTaskHistory: async () => ({
        events: [{
          action: "block",
          details: {
            diagnostic: {
              code: "worker_failure",
              stage: "worker",
              operation: "provider_call;injected",
              category: "cleanup_failure;injected",
              cleanupOutcome: "failed;injected",
            },
          },
        }],
      }),
    },
  );
  const body = await response.json() as { events: Array<{ details: { diagnostic?: Record<string, unknown> } }> };
  assert.deepEqual(body.events[0].details.diagnostic, {
    code: "worker_failure",
    stage: "worker",
  });
});
