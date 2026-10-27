import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_REMOTE_JSON_BYTES,
  normalizeRemoteStatusPayload,
  parseBoundedRemoteJson,
} from "./remote-payload";

test("parseBoundedRemoteJson rejects oversized payloads", () => {
  const oversized = `"${"a".repeat(MAX_REMOTE_JSON_BYTES)}"`;
  assert.equal(parseBoundedRemoteJson(oversized), null);
});

test("normalizeRemoteStatusPayload rejects unknown root keys", () => {
  assert.equal(
    normalizeRemoteStatusPayload({ tasks: [], leakedSecret: "token" }),
    null,
  );
});

test("normalizeRemoteStatusPayload accepts bounded known fields", () => {
  const payload = normalizeRemoteStatusPayload({
    tasks: [{ id: "task-1", title: "Plan release", status: "planned", blockers: [] }],
    lastSuccessfulUpdate: "2026-01-01T00:00:00.000Z",
  });
  assert.ok(payload);
  assert.equal(payload?.tasks?.length, 1);
});
