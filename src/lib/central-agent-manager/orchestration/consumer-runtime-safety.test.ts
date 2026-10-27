import assert from "node:assert/strict";
import test from "node:test";
import {
  CAM_AUDIT_JOB_DO_NOT_TOUCH,
  CAM_COMPLETED_STAGING_JOB_5B,
  diagnoseConsumerRuntimeFlags,
  isProtectedStagingAuditJobId,
  isProtectedStagingJobId,
  redactAuthorizationHeader,
  rejectConsumerMutationOnAuditJob,
} from "./consumer-runtime-safety";

test("staging artifact job ids are protected from consumer mutations", () => {
  assert.equal(isProtectedStagingAuditJobId(CAM_AUDIT_JOB_DO_NOT_TOUCH), true);
  assert.equal(isProtectedStagingJobId(CAM_COMPLETED_STAGING_JOB_5B), true);
  assert.throws(() => rejectConsumerMutationOnAuditJob(CAM_AUDIT_JOB_DO_NOT_TOUCH), /must not mutate/);
  assert.throws(() => rejectConsumerMutationOnAuditJob(CAM_COMPLETED_STAGING_JOB_5B), /must not mutate/);
  rejectConsumerMutationOnAuditJob("job-other");
});

test("redactAuthorizationHeader never returns bearer secret", () => {
  assert.equal(redactAuthorizationHeader("Bearer super-secret-token-value"), "Bearer [redacted]");
  assert.equal(redactAuthorizationHeader(null), "");
});

test("diagnoseConsumerRuntimeFlags reports disabled defaults", () => {
  const diag = diagnoseConsumerRuntimeFlags({});
  assert.equal(diag.consumerEnabled, false);
  assert.equal(diag.bridgeEnabled, false);
});
