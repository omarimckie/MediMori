import assert from "node:assert/strict";
import test from "node:test";
import { resolveTrustedApprovalStoreFromEnv } from "../phase6d/approval-store-resolver";
import { unavailableApprovalStore } from "../supervisor/trusted-approval";

test("approval resolver stays fail-closed without persistence flag", async () => {
  const store = resolveTrustedApprovalStoreFromEnv({});
  await assert.rejects(() => store.readTask("t1"), /unavailable/i);
});

test("approval resolver uses in-memory disposable only when explicitly allowed", async () => {
  const store = resolveTrustedApprovalStoreFromEnv({
    CAM_APPROVAL_PERSISTENCE_ENABLED: "true",
    CAM_APPROVAL_DISPOSABLE_DATABASE_URL: "postgresql://local/disposable",
    CAM_APPROVAL_ALLOW_IN_MEMORY_DISPOSABLE: "true",
  });
  assert.notEqual(store, unavailableApprovalStore);
  assert.equal(await store.readTask("missing"), null);
});

test("postgres store wiring fail-closed without explicit identity env", () => {
  const store = resolveTrustedApprovalStoreFromEnv({
    CAM_APPROVAL_PERSISTENCE_ENABLED: "true",
    CAM_APPROVAL_DISPOSABLE_DATABASE_URL: "postgresql://local/disposable",
    CAM_APPROVAL_USE_POSTGRES_STORE: "true",
    CAM_APPROVAL_PROJECT_ID: "",
    CAM_APPROVAL_BRANCH_ID: "",
    CAM_APPROVAL_DATABASE_NAME: "",
    CAM_APPROVAL_ENDPOINT_ID: "",
  });
  assert.equal(store, unavailableApprovalStore);
});
