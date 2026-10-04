import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSmartUploadSessionBatchId,
  SMART_UPLOAD_SESSION_BATCH_ID_UNASSIGNED,
} from "./smart-upload-session-batch";

test("batch id is not assigned during SSR placeholder", () => {
  assert.equal(SMART_UPLOAD_SESSION_BATCH_ID_UNASSIGNED, null);
});

test("createSmartUploadSessionBatchId returns a UUID", () => {
  const id = createSmartUploadSessionBatchId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});
