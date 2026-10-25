import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatPreflightErrorWithRecovery,
  partialPublicationFailureOperatorGuidance,
  preflightBlocksPublicationRetry,
} from "./marketing-publish-operator-guidance";

test("preflight recovery text is appended for tracking failures", () => {
  const formatted = formatPreflightErrorWithRecovery(
    "tracking_link_required",
    "Token missing.",
  );
  assert.match(formatted, /tracking_link_required: Token missing\./);
  assert.match(formatted, /Recovery:/);
});

test("preflight blocks retry until remediated", () => {
  assert.equal(preflightBlocksPublicationRetry("tracking_link_required"), true);
  assert.equal(preflightBlocksPublicationRetry("destination_path_invalid"), true);
});

test("partial publication guidance warns against blind batch reschedule", () => {
  const text = partialPublicationFailureOperatorGuidance("instagram", "facebook");
  assert.match(text, /instagram published/i);
  assert.match(text, /facebook/i);
  assert.match(text, /duplicate/i);
  assert.doesNotMatch(text, /republish the published|retry both|automatically retry the whole batch/i);
  assert.match(text, /single-platform retry/i);
  assert.match(text, /confirming the published leg is correct/i);
});
