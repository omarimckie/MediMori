import assert from "node:assert/strict";
import test from "node:test";
import { SupervisorContractError } from "../supervisor/types";
import {
  OrchestrationEvidenceStore,
  acceptOrchestrationEvidence,
} from "./orchestration-evidence";

const NOW = "2026-10-24T18:00:00.000Z";

test("orchestration evidence requires work_completed for completion", () => {
  const store = new OrchestrationEvidenceStore();
  const progress = acceptOrchestrationEvidence({
    id: "ev-1",
    jobId: "job-1",
    assignmentId: "asgn-1",
    agentId: "agent-a",
    kind: "progress_note",
    createdAt: NOW,
  });
  store.register(progress);
  assert.throws(
    () => store.assertCompletionEvidence("asgn-1", "agent-a", "job-1", ["ev-1"]),
    (error: unknown) => error instanceof SupervisorContractError,
  );
  const done = acceptOrchestrationEvidence({
    id: "ev-2",
    jobId: "job-1",
    assignmentId: "asgn-1",
    agentId: "agent-a",
    kind: "work_completed",
    createdAt: NOW,
    artifactRef: "artifacts/run-1.json",
  });
  store.register(done);
  const ids = store.assertCompletionEvidence("asgn-1", "agent-a", "job-1", ["ev-2"]);
  assert.deepEqual(ids, ["ev-2"]);
});

test("orchestration evidence rejects cross-assignment references", () => {
  const store = new OrchestrationEvidenceStore();
  const done = acceptOrchestrationEvidence({
    id: "ev-x",
    jobId: "job-1",
    assignmentId: "asgn-1",
    agentId: "agent-a",
    kind: "work_completed",
    createdAt: NOW,
  });
  store.register(done);
  assert.throws(() => store.assertCompletionEvidence("asgn-2", "agent-a", "job-1", ["ev-x"]));
});
