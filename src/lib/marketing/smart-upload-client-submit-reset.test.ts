import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countSmartUploadSubmitTargets,
  defaultSmartUploadClientFormState,
  formatSmartUploadSubmitSuccessMessage,
  shouldAutoResetSmartUploadAfterSubmitValid,
  type SmartUploadWorkspaceFileStatus,
} from "./smart-upload-client-session";
import { SMART_UPLOAD_DESTINATIONS_ALL } from "./smart-upload-destinations";

function file(id: string, status: SmartUploadWorkspaceFileStatus) {
  return { id, status };
}

test("single image successfully submitted triggers auto-reset", () => {
  const before = [file("a", "ready")];
  const after = [file("a", "submitted")];
  assert.equal(shouldAutoResetSmartUploadAfterSubmitValid(before, after), true);
});

test("multiple images all successfully submitted triggers auto-reset", () => {
  const before = [file("a", "ready"), file("b", "validating")];
  const after = [file("a", "submitted"), file("b", "submitted")];
  assert.equal(shouldAutoResetSmartUploadAfterSubmitValid(before, after), true);
});

test("partial success does not auto-reset", () => {
  const before = [file("a", "ready"), file("b", "needs_attention")];
  const after = [file("a", "submitted"), file("b", "needs_attention")];
  assert.equal(shouldAutoResetSmartUploadAfterSubmitValid(before, after), false);
});

test("failed submission does not auto-reset", () => {
  const before = [file("a", "ready")];
  const after = [file("a", "failed")];
  assert.equal(shouldAutoResetSmartUploadAfterSubmitValid(before, after), false);
});

test("already-submitted workspace with no new targets does not auto-reset", () => {
  const before = [file("a", "submitted")];
  const after = [file("a", "submitted")];
  assert.equal(shouldAutoResetSmartUploadAfterSubmitValid(before, after), false);
});

test("mixed prior submitted and new success only resets when all new targets submitted", () => {
  const before = [file("a", "submitted"), file("b", "ready")];
  const after = [file("a", "submitted"), file("b", "submitted")];
  assert.equal(shouldAutoResetSmartUploadAfterSubmitValid(before, after), true);
});

test("default form state matches initial Smart Upload selections", () => {
  const defaults = defaultSmartUploadClientFormState();
  assert.deepEqual(defaults.destinations, SMART_UPLOAD_DESTINATIONS_ALL);
  assert.equal(defaults.weeklyPlanId, "");
  assert.equal(defaults.campaignId, "");
  assert.equal(defaults.bookId, "");
});

test("success message is stable for accessibility copy", () => {
  assert.match(formatSmartUploadSubmitSuccessMessage(1), /Successfully submitted 1 image/);
  assert.match(formatSmartUploadSubmitSuccessMessage(2), /Successfully submitted 2 images/);
});

test("submit target count ignores already-submitted rows", () => {
  assert.equal(countSmartUploadSubmitTargets([file("a", "submitted"), file("b", "ready")]), 1);
});

test("files added during submit block auto-reset even when prior targets succeeded", () => {
  const before = [file("a", "ready")];
  const after = [file("a", "submitted"), file("b", "ready")];
  assert.equal(shouldAutoResetSmartUploadAfterSubmitValid(before, after), false);
});
