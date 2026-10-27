import assert from "node:assert/strict";
import test from "node:test";
import {
  dryRunValidateDisposableManifest,
  MANDATORY_DISPOSABLE_VERIFICATION_IDS,
  disposableVerificationManifest,
} from "./disposable-verification-manifest";

test("offline disposable manifest is complete and has no duplicates", () => {
  const report = dryRunValidateDisposableManifest();
  assert.equal(report.ok, true);
  assert.equal(report.caseCount, 38);
  assert.equal(MANDATORY_DISPOSABLE_VERIFICATION_IDS.length, 38);
  assert.equal(disposableVerificationManifest.length, 38);
  for (const case_ of disposableVerificationManifest) {
    assert.ok(case_.sqlOperations.length > 0);
    assert.ok(case_.evidence.length > 0);
  }
});
