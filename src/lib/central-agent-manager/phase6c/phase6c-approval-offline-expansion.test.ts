import assert from "node:assert/strict";
import test from "node:test";
import { createOfflineDisposableMockPort } from "../adapter/approval-disposable-offline-mock-port";
import { runDisposableCaseOffline } from "../adapter/approval-disposable-postgres-executor";
import { disposableVerificationManifest } from "../verification/disposable-verification-manifest";

const EXPANDED_SLICE = [
  "1.1", "1.2", "1.3", "1.4",
  "2.1", "2.2", "2.3", "2.4",
  "3.1", "3.2", "3.3", "3.4", "3.5",
  "4.1", "4.2", "4.3", "4.4", "4.5",
  "5.1", "5.2", "5.3", "5.4", "5.5",
  "6.1", "6.2", "6.3", "6.4",
  "7.1", "7.2", "7.3",
];

test("offline disposable mock covers expanded manifest slice toward 38 cases", async () => {
  for (const id of EXPANDED_SLICE) {
    const case_ = disposableVerificationManifest.find((row) => row.id === id);
    assert.ok(case_, `missing manifest ${id}`);
    const port = createOfflineDisposableMockPort(case_);
    const result = await runDisposableCaseOffline(case_, port);
    assert.equal(result.ok, true, `case ${id}`);
  }
});
