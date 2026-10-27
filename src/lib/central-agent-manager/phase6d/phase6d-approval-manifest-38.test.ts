import assert from "node:assert/strict";
import test from "node:test";
import { createOfflineDisposableMockPort } from "../adapter/approval-disposable-offline-mock-port";
import { runDisposableCaseOffline } from "../adapter/approval-disposable-postgres-executor";
import {
  disposableVerificationManifest,
  MANDATORY_DISPOSABLE_VERIFICATION_IDS,
} from "../verification/disposable-verification-manifest";

test("offline disposable mock runs all 38 mandatory manifest cases", async () => {
  for (const id of MANDATORY_DISPOSABLE_VERIFICATION_IDS) {
    const case_ = disposableVerificationManifest.find((row) => row.id === id);
    assert.ok(case_, `missing manifest case ${id}`);
    const port = createOfflineDisposableMockPort(case_);
    const result = await runDisposableCaseOffline(case_, port);
    assert.equal(result.ok, true, `case ${id}`);
  }
});
