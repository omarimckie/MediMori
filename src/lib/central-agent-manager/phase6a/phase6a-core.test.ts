import assert from "node:assert/strict";
import test from "node:test";
import { resolveSpecialistTemplate } from "./specialist-template-registry";
import { assertOverlayCannotExpand, getProjectPolicy, resolveEffectivePermissions } from "./project-policy";
import { validateObjectivePlan, type ObjectivePlanV1 } from "./objective-plan";
import { matchWorkerForTask } from "./worker-matching";
import { WorkerLifecycleStore } from "./worker-lifecycle";
import { DisabledCursorExecutionAdapter, FakeTransportCursorExecutionAdapter } from "./cursor-execution-adapter";
import { FakeCursorCloudApiTransport } from "../orchestration/cursor-bridge/fake-cursor-cloud-api-transport";

const NOW = "2026-10-26T16:00:00.000Z";

test("template registry rejects privilege-expanding overlay", () => {
  assert.throws(() =>
    resolveSpecialistTemplate("engineering", 1, { addToolClasses: ["shell"] }),
  );
});

test("project overlay cannot grant platform-denied operation", () => {
  assert.throws(() =>
    assertOverlayCannotExpand({
      baseDenied: ["production_secrets"],
      overlayAddOperations: ["production_secrets"],
    }),
  );
});

test("twilight feather policy denies deploy readiness tools", () => {
  const template = resolveSpecialistTemplate("devops", 1);
  const effective = resolveEffectivePermissions({
    projectId: "twilight_feather",
    template,
    taskOperations: ["deploy_readiness_check"],
  });
  assert.ok(effective.deniedReasons.some((r) => r.startsWith("tool_denied")));
});

test("plan validation rejects dependency cycles", () => {
  const plan: ObjectivePlanV1 = {
    contractVersion: "cam-objective-plan/v1",
    objectiveId: "obj",
    projectId: "medimori",
    parentObjective: "x",
    budgetUsd: 1,
    deadlineAt: NOW,
    retryPolicy: { maxFollowUpTasks: 1, maxRetriesPerTask: 1 },
    tasks: [
      {
        id: "a",
        title: "a",
        requiredCapabilities: [],
        dependsOn: ["b"],
        acceptanceCriteria: [],
        protectedOperations: [],
        maxRetries: 0,
        evidenceRequired: [],
        state: "pending",
      },
      {
        id: "b",
        title: "b",
        requiredCapabilities: [],
        dependsOn: ["a"],
        acceptanceCriteria: [],
        protectedOperations: [],
        maxRetries: 0,
        evidenceRequired: [],
        state: "pending",
      },
    ],
  };
  assert.throws(() => validateObjectivePlan(plan));
});

test("worker matching fails closed without authorized backend", () => {
  const result = matchWorkerForTask({
    projectId: "medimori",
    requiredCapabilities: ["prepare_plan"],
    taskOperations: ["prepare_plan"],
    backends: [{ role: "devops", adapterEnabled: false, concurrentSlots: 0 }],
    budgetRemainingUsd: 1,
    candidateTaskId: "t1",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "no_backend");
});

test("worker lifecycle is idempotent on provision", () => {
  const store = new WorkerLifecycleStore();
  const first = store.apply({
    type: "provision",
    workerId: "w1",
    role: "engineering",
    objectiveId: "obj",
    taskId: "t1",
    now: NOW,
  });
  const second = store.apply({
    type: "provision",
    workerId: "w1",
    role: "engineering",
    objectiveId: "obj",
    taskId: "t1",
    now: NOW,
  });
  assert.equal(first.workerId, second.workerId);
});

test("cursor execution adapter disabled by default", async () => {
  const adapter = new DisabledCursorExecutionAdapter();
  await assert.rejects(async () => {
    await adapter.createRun({ promptText: "x", repoUrl: "https://example.com/r" });
  });
});

test("fake cursor adapter uses transport without live API", async () => {
  const transport = new FakeCursorCloudApiTransport();
  const adapter = new FakeTransportCursorExecutionAdapter(transport);
  const identity = await adapter.createRun({
    promptText: "offline",
    repoUrl: "https://github.com/example/medimori",
  });
  transport.configurePollsBeforeFinished(0);
  const progress = await adapter.pollRun(identity);
  assert.equal(progress.status, "finished");
});
