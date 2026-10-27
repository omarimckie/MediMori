import assert from "node:assert/strict";
import test from "node:test";
import { createOfflineDisposableMockPort } from "../adapter/approval-disposable-offline-mock-port";
import { runDisposableCaseOffline } from "../adapter/approval-disposable-postgres-executor";
import {
  disposableVerificationManifest,
  MANDATORY_DISPOSABLE_VERIFICATION_IDS,
} from "../verification/disposable-verification-manifest";

test("manifest report: offline mock backend", async () => {
  let pass = 0;
  for (const id of MANDATORY_DISPOSABLE_VERIFICATION_IDS) {
    const case_ = disposableVerificationManifest.find((row) => row.id === id);
    assert.ok(case_);
    const port = createOfflineDisposableMockPort(case_);
    const result = await runDisposableCaseOffline(case_, port);
    if (result.ok) pass += 1;
  }
  assert.equal(pass, 38);
});

test("manifest report: PGlite SQL function backend not executed (requires Neon PL/pgSQL package)", () => {
  assert.equal(process.env.CAM_APPROVAL_DISPOSABLE_EXECUTE, undefined);
});

test("manifest report: server PostgreSQL not executed in Phase 6f offline assignment", () => {
  assert.equal(process.env.CAM_ORCHESTRATION_DISPOSABLE_DATABASE_URL, undefined);
});
