import assert from "node:assert/strict";
import test from "node:test";
import { limits } from "../../engineering/policy";
import {
  acceptEvidence,
  applyOwnerApproval,
  assertRetryDoesNotReset,
  completeTask,
  confirmSessionRunning,
  createSupervisorTask,
  enterExecution,
  evaluateExecution,
  evaluateRecovery,
  hasVerifiedCompletion,
  markPolicyEligible,
  openSession,
  SupervisorContractError,
  transitionSession,
  transitionTask,
} from "./index";
import type { ApprovalEvidence, BudgetUsage, EvidenceRecord, SessionRecord, SupervisorTask } from "./types";
import type { EvaluationInput } from "./evaluate";

const now = "2026-10-21T20:00:00.000Z";
const later = "2026-10-22T20:00:00.000Z";
const earlier = "2026-10-21T19:00:00.000Z";

function task(
  specialist: SupervisorTask["specialistId"],
  operations: readonly string[],
  id = "task-1",
): SupervisorTask {
  return createSupervisorTask({
    id,
    goalId: "goal-1",
    specialistId: specialist,
    description: "Prepare the requested work.",
    requestedOperations: operations,
    idempotencyKey: "idem-1",
    planVersion: 3,
    now,
  });
}

function approvedSafe(operations: readonly string[] = ["read_content"]): SupervisorTask {
  return markPolicyEligible(transitionTask(task("marketing", operations), "awaiting_approval", now), now);
}

function approval(overrides: Partial<ApprovalEvidence> = {}): ApprovalEvidence {
  return {
    id: "approval-1",
    taskId: "task-1",
    operation: "merge_main",
    principal: { kind: "owner", id: "owner-1" },
    scope: { taskId: "task-1", operation: "merge_main", planVersion: 3 },
    decision: "approved",
    createdAt: now,
    expiresAt: later,
    revokedAt: null,
    planVersion: 3,
    ...overrides,
  };
}

function evaluation(
  current: SupervisorTask,
  operation: string,
  evidence: ApprovalEvidence | null = null,
  extra: { usage?: BudgetUsage; isolationSatisfied?: boolean; now?: string } = {},
): EvaluationInput {
  return {
    task: extra.usage ? { ...current, usage: extra.usage } : current,
    operation,
    approval: evidence,
    isolationSatisfied: extra.isolationSatisfied ?? true,
    now: extra.now ?? now,
  };
}

function decide(
  current: SupervisorTask,
  operation: string,
  evidence: ApprovalEvidence | null = null,
  extra: { usage?: BudgetUsage; isolationSatisfied?: boolean; now?: string } = {},
) {
  return evaluateExecution(evaluation(current, operation, evidence, extra));
}

function verifiedWork(current: SupervisorTask, id = "evidence-work"): EvidenceRecord {
  return acceptEvidence(
    {
      id,
      taskId: current.id,
      sessionId: current.sessionId,
      kind: "work_completed",
      source: "executor",
      createdAt: now,
      verification: "verified",
      artifactRef: "notes/result.txt",
    },
    current,
  );
}

function runningEngineering(): { task: SupervisorTask; session: SessionRecord } {
  const created = task("engineering", ["merge_main"]);
  const session: SessionRecord = {
    id: "session-1",
    taskId: created.id,
    specialistId: "engineering",
    adapterId: "engineering-worker",
    externalSessionRef: "bc-session-1",
    state: "running",
    startedAt: now,
    endedAt: null,
    cancellation: "none",
    failure: "none",
    usage: { ...created.usage },
    evidenceIds: [],
  };
  return {
    task: {
      ...created,
      state: "running",
      sessionId: session.id,
      lease: { holderSessionId: session.id, expiresAt: later },
    },
    session,
  };
}

function runningMarketing(): { task: SupervisorTask; session: SessionRecord } {
  const approved = approvedSafe();
  const input = evaluation(approved, "read_content");
  const opened = openSession({ ...input, sessionId: "session-read" });
  const session = confirmSessionRunning({ ...opened, externalSessionRef: "bc-session-read" }, input);
  const started = enterExecution(input);
  return {
    task: {
      ...started,
      sessionId: session.id,
      lease: { holderSessionId: session.id, expiresAt: later },
    },
    session,
  };
}

test("unapproved protected operation cannot execute", () => {
  const current = transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now);
  const forged = { ...current, state: "approved" as const, approvalState: "owner_approved" as const };
  const decision = decide(forged, "merge_main", null);
  assert.equal(decision.outcome, "requires_approval");
  assert.throws(() => enterExecution(evaluation(forged, "merge_main", null)), SupervisorContractError);
});

test("owner approval permits only the authorized operation", () => {
  const waiting = transitionTask(
    task("engineering", ["merge_main", "production_deploy"]),
    "awaiting_approval",
    now,
  );
  const evidence = approval();
  assert.throws(() => applyOwnerApproval(waiting, evidence, now), /Untrusted approval/);
  const forged = { ...waiting, state: "approved" as const };
  assert.equal(decide(forged, "merge_main", evidence).outcome, "requires_approval");
  assert.equal(decide(forged, "production_deploy", evidence).outcome, "denied");
});

test("approval for another task is rejected", () => {
  const waiting = transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now);
  const evidence = approval({ taskId: "task-2", scope: { taskId: "task-2", operation: "merge_main", planVersion: 3 } });
  assert.throws(() => applyOwnerApproval(waiting, evidence, now), /task_mismatch/);
});

test("approval for another operation is rejected", () => {
  const waiting = transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now);
  const evidence = approval({
    operation: "production_deploy",
    scope: { taskId: "task-1", operation: "production_deploy", planVersion: 3 },
  });
  assert.throws(() => applyOwnerApproval(waiting, evidence, now), /operation_mismatch|outside the task scope/);
});

test("expired approval is rejected", () => {
  const waiting = transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now);
  assert.throws(() => applyOwnerApproval(waiting, approval({ expiresAt: earlier }), now), /expired/);
  assert.throws(() => applyOwnerApproval(waiting, approval({ expiresAt: "not-a-timestamp" }), now), /expired/);
});

test("revoked approval is rejected", () => {
  const waiting = transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now);
  assert.throws(() => applyOwnerApproval(waiting, approval({ revokedAt: now }), now), /revoked/);
});

test("manager approval does not satisfy an owner gate", () => {
  const waiting = transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now);
  const evidence = approval({ principal: { kind: "manager", id: "manager-1" } });
  assert.throws(() => applyOwnerApproval(waiting, evidence, now), /not_owner/);
  const forged = { ...waiting, state: "approved" as const };
  assert.equal(decide(forged, "merge_main", evidence).outcome, "denied");
});

test("unknown operation is denied", () => {
  const current = approvedSafe();
  assert.equal(decide(current, "drop_database").outcome, "denied");
});

test("a specialist cannot expand its own capability scope", () => {
  assert.throws(
    () => task("marketing", ["merge_main"]),
    /cannot expand its capability scope/,
  );
  const current = approvedSafe();
  const forged = { ...current, allowedCapabilityScope: ["read_content", "merge_main"] };
  assert.equal(decide(forged, "read_content").outcome, "denied");
});

test("a profile-visible protected operation still requires owner approval", () => {
  const current = { ...transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now), state: "approved" as const };
  assert.equal(decide(current, "merge_main").outcome, "requires_approval");
  assert.equal(current.budget.modelCalls, limits.modelCalls);
});

test("valid task transitions succeed and invalid transitions fail", () => {
  const created = task("marketing", ["read_content"]);
  const waiting = transitionTask(created, "awaiting_approval", now);
  assert.equal(waiting.state, "awaiting_approval");
  assert.throws(() => transitionTask(created, "running", now), SupervisorContractError);
  assert.throws(() => transitionTask(waiting, "completed", now), SupervisorContractError);
});

test("approved does not mean running", () => {
  const current = approvedSafe();
  const decision = decide(current, "read_content");
  assert.equal(decision.outcome, "allowed");
  assert.equal(current.state, "approved");
  assert.equal(enterExecution(evaluation(current, "read_content")).state, "running");
});

test("blocked tasks cannot execute", () => {
  const blocked = transitionTask(task("marketing", ["read_content"]), "blocked", now);
  assert.equal(decide(blocked, "read_content").outcome, "blocked");
  assert.throws(() => transitionTask(blocked, "running", now), SupervisorContractError);
});

test("completed tasks cannot execute again", () => {
  const current = approvedSafe();
  const input = evaluation(current, "read_content");
  const opened = openSession({ ...input, sessionId: "session-1" });
  const running = { ...enterExecution(input), sessionId: opened.id };
  const completed = completeTask(running, [verifiedWork(running)], now);
  assert.equal(completed.state, "completed");
  assert.throws(() => transitionTask(running, "completed", now), /verified evidence/);
  assert.equal(decide(completed, "read_content").outcome, "blocked");
  assert.throws(() => enterExecution(evaluation(completed, "read_content")), SupervisorContractError);
});

test("exhausted call, token, cost, and runtime budgets block execution", () => {
  const current = approvedSafe();
  assert.equal(decide(current, "read_content", null, { usage: { ...current.usage, modelCalls: current.budget.modelCalls } }).outcome, "blocked");
  assert.equal(decide(current, "read_content", null, { usage: { ...current.usage, tokens: current.budget.tokens } }).outcome, "blocked");
  assert.equal(decide(current, "read_content", null, { usage: { ...current.usage, costUsd: current.budget.costUsd } }).outcome, "blocked");
  assert.equal(decide(current, "read_content", null, { usage: { ...current.usage, elapsedMs: current.budget.durationMs } }).outcome, "blocked");
});

test("missing usage data fails closed", () => {
  const current = approvedSafe();
  const decision = decide(current, "read_content", null, { usage: { ...current.usage, tokens: null } });
  assert.equal(decision.outcome, "blocked");
  if (decision.outcome === "blocked") assert.match(decision.reason, /unavailable/);
});

test("retry cannot reset the original budget", () => {
  const current = approvedSafe();
  const exhausted = { ...current.usage, modelCalls: current.budget.modelCalls };
  assert.throws(() => assertRetryDoesNotReset(exhausted, current.usage), /cannot reset/);
  assert.throws(
    () =>
      evaluateExecution({
        task: { ...current, usage: exhausted },
        operation: "read_content",
        approval: null,
        proposedUsage: current.usage,
        isolationSatisfied: true,
        now,
      }),
    /cannot reset/,
  );
});

test("session cannot start without task eligibility", () => {
  const blocked = transitionTask(task("marketing", ["read_content"]), "blocked", now);
  assert.throws(
    () => openSession({ ...evaluation(blocked, "read_content"), sessionId: "session-1" }),
    /cannot start/,
  );
});

test("completed, cancelled, and unidentified sessions cannot resume", () => {
  const { task: current, session } = runningEngineering();
  const completed = transitionSession(session, "completed", now);
  const cancelled = transitionSession(session, "cancelled", now);
  assert.equal(evaluateRecovery({ task: current, session: completed, operation: "merge_main", approval: approval(), now, isolationSatisfied: true }).eligible, false);
  assert.equal(evaluateRecovery({ task: current, session: cancelled, operation: "merge_main", approval: approval(), now, isolationSatisfied: true }).eligible, false);
  assert.equal(
    evaluateRecovery({
      task: current,
      session: { ...session, externalSessionRef: null },
      operation: "merge_main",
      approval: approval(),
      now,
      isolationSatisfied: true,
    }).eligible,
    false,
  );
});

test("expired approval blocks resume and recovery keeps the original task budget", () => {
  const { task: current, session } = runningEngineering();
  const expired = evaluateRecovery({
    task: current,
    session,
    operation: "merge_main",
    approval: approval({ expiresAt: earlier }),
    now,
    isolationSatisfied: true,
  });
  assert.equal(expired.eligible, false);
  const readable = runningMarketing();
  const recovered = evaluateRecovery({
    task: readable.task,
    session: readable.session,
    operation: "read_content",
    approval: null,
    now,
    isolationSatisfied: true,
  });
  assert.equal(recovered.eligible, true);
  if (recovered.eligible) {
    assert.equal(recovered.taskId, readable.task.id);
    assert.equal(recovered.idempotencyKey, readable.task.idempotencyKey);
    assert.deepEqual(recovered.budget, readable.task.budget);
    assert.deepEqual(recovered.usage, readable.task.usage);
  }
});

test("a model success claim is not verified completion", () => {
  const current = { ...approvedSafe(), sessionId: "session-1", validationRequired: true };
  const claim = acceptEvidence(
    {
      id: "evidence-1",
      taskId: current.id,
      sessionId: "session-1",
      kind: "work_completed",
      source: "model",
      createdAt: now,
      verification: "verified",
      artifactRef: "notes/result.txt",
    },
    current,
  );
  assert.equal(claim.verification, "unverified");
  assert.equal(hasVerifiedCompletion(current, [claim]), false);
});

test("missing validation evidence prevents verified completion", () => {
  const current = { ...approvedSafe(), sessionId: "session-1", validationRequired: true };
  const work = acceptEvidence(
    {
      id: "evidence-2",
      taskId: current.id,
      sessionId: "session-1",
      kind: "work_completed",
      source: "executor",
      createdAt: now,
      verification: "verified",
      artifactRef: "notes/result.txt",
    },
    current,
  );
  assert.equal(hasVerifiedCompletion(current, [work]), false);
});

test("invalid evidence references are rejected and diagnostics are scrubbed", () => {
  const current = { ...approvedSafe(), sessionId: "session-1" };
  assert.throws(
    () =>
      acceptEvidence(
        {
          id: "evidence-3",
          taskId: "task-9",
          sessionId: "session-1",
          kind: "proposed",
          source: "policy",
          createdAt: now,
          verification: "unverified",
          artifactRef: "../secret",
        },
        current,
      ),
    SupervisorContractError,
  );
  const stored = acceptEvidence(
    {
      id: "evidence-4",
      taskId: current.id,
      sessionId: "session-1",
      kind: "execution_blocked",
      source: "policy",
      createdAt: now,
      verification: "verified",
      artifactRef: null,
      diagnostic: "failed Bearer super-secret-token postgresql://user:pass@db.internal/neondb",
    },
    current,
  );
  assert.equal(stored.diagnostic.includes("super-secret-token"), false);
  assert.equal(stored.diagnostic.includes("postgresql://"), false);
  assert.match(stored.diagnostic, /\[redacted\]/);
});

test("specialist boundaries stay fail closed", () => {
  const marketing = {
    ...transitionTask(task("marketing", ["external_publish"]), "awaiting_approval", now),
    state: "approved" as const,
  };
  assert.equal(decide(marketing, "external_publish").outcome, "requires_approval");
  const engineering = { ...transitionTask(task("engineering", ["production_secrets"]), "awaiting_approval", now), state: "approved" as const };
  assert.equal(decide(engineering, "production_secrets").outcome, "requires_approval");
  const research = markPolicyEligible(transitionTask(task("research", ["read_research"]), "awaiting_approval", now), now);
  const researchOwner = approval({
    operation: "repository_write",
    scope: { taskId: "task-1", operation: "repository_write", planVersion: 3 },
  });
  assert.equal(decide(research, "repository_write", researchOwner).outcome, "denied");
  assert.equal(decide(research, "database_write").outcome, "denied");
  const operations = markPolicyEligible(transitionTask(task("operations", ["read_health"], "task-ops"), "awaiting_approval", now), now);
  assert.equal(decide({ ...operations, id: "task-ops" }, "activate_worker").outcome, "denied");
  assert.equal(decide(operations, "modify_environment").outcome, "denied");
  assert.equal(decide(operations, "modify_credentials").outcome, "denied");
  assert.equal(decide(operations, "perform_repair").outcome, "denied");
});

test("a forged allowed decision cannot start work", () => {
  const waiting = transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now);
  const forged = { ...waiting, state: "approved" as const, approvalState: "owner_approved" as const };
  assert.throws(() => enterExecution(evaluation(forged, "merge_main", null)), /cannot enter execution/);
  assert.throws(
    () => openSession({ ...evaluation(forged, "merge_main", null), sessionId: "session-forged" }),
    /cannot start/,
  );
  const safe = approvedSafe();
  const opened = openSession({ ...evaluation(safe, "read_content"), sessionId: "session-safe" });
  assert.throws(() => transitionSession(opened, "running", now), /fresh eligibility/);
  assert.throws(
    () => transitionSession({ ...opened, state: "waiting_for_approval" }, "running", now),
    /fresh eligibility/,
  );
  assert.equal(confirmSessionRunning(opened, evaluation(safe, "read_content")).state, "running");
});

test("unknown specialists and non-owner principals are denied", () => {
  const current = approvedSafe();
  const unknown = { ...current, specialistId: "intruder" as SupervisorTask["specialistId"] };
  assert.equal(decide(unknown, "read_content").outcome, "denied");
  assert.throws(
    () =>
      createSupervisorTask({
        id: "task-x",
        goalId: "goal-1",
        specialistId: "intruder" as SupervisorTask["specialistId"],
        description: "Prepare the requested work.",
        requestedOperations: ["read_content"],
        idempotencyKey: "idem-x",
        now,
      }),
    /Unknown specialist/,
  );
  const waiting = transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now);
  assert.throws(
    () => applyOwnerApproval(waiting, approval({ principal: { kind: "specialist", id: "engineering" } }), now),
    /not_owner/,
  );
  assert.throws(
    () => applyOwnerApproval(waiting, approval({ principal: { kind: "system_policy", id: "eligibility" } }), now),
    /not_owner/,
  );
  assert.throws(() => markPolicyEligible(waiting, now), /Owner approval is required/);
});

test("caller-supplied owner principal cannot authorize protected work", () => {
  const waiting = transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now);
  const fabricated = approval({ principal: { kind: "owner", id: "not-proven" } });
  assert.throws(() => applyOwnerApproval(waiting, fabricated, now), /Untrusted approval/);
  const forged = { ...waiting, state: "approved" as const };
  assert.equal(decide(forged, "merge_main", fabricated).outcome, "requires_approval");
});

test("approval does not transfer across marketing operations or plan versions", () => {
  const waiting = transitionTask(
    task("marketing", ["external_publish", "send_notification", "modify_live_schedule"]),
    "awaiting_approval",
    now,
  );
  const evidence = approval({
    operation: "external_publish",
    scope: { taskId: "task-1", operation: "external_publish", planVersion: 3 },
  });
  assert.throws(() => applyOwnerApproval(waiting, evidence, now), /Untrusted approval/);
  const forged = { ...waiting, state: "approved" as const };
  assert.equal(decide(forged, "external_publish", evidence).outcome, "requires_approval");
  assert.equal(decide(forged, "send_notification", evidence).outcome, "denied");
  assert.equal(decide(forged, "modify_live_schedule", evidence).outcome, "denied");
  const staleVersion = approval({
    planVersion: 2,
    scope: { taskId: "task-1", operation: "merge_main", planVersion: 2 },
  });
  const engineering = transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now);
  assert.throws(() => applyOwnerApproval(engineering, staleVersion, now), /version_mismatch/);
  const current = { ...engineering, state: "approved" as const };
  assert.equal(decide({ ...current, planVersion: 4 }, "merge_main", approval()).outcome, "denied");
});

test("approval cannot authorize a prohibited or widened scope", () => {
  const research = transitionTask(task("research", ["read_research"]), "awaiting_approval", now);
  const widened = {
    ...research,
    requestedOperations: ["read_research", "repository_write"],
    allowedCapabilityScope: ["read_research", "repository_write"],
  };
  const evidence = approval({
    operation: "repository_write",
    scope: { taskId: "task-1", operation: "repository_write", planVersion: 3 },
  });
  assert.throws(() => applyOwnerApproval(widened, evidence, now), /prohibition/);
  assert.equal(decide({ ...widened, state: "approved" }, "read_research").outcome, "denied");
  const approved = {
    ...transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now),
    state: "approved" as const,
  };
  const expanded = {
    ...approved,
    requestedOperations: ["merge_main", "prepare_plan"],
  };
  assert.equal(decide(expanded, "merge_main", approval()).outcome, "denied");
});

test("malformed budgets, enlargement, and concurrency fail closed", () => {
  const current = approvedSafe();
  assert.equal(
    decide(current, "read_content", null, { usage: { ...current.usage, tokens: -1 } }).outcome,
    "blocked",
  );
  assert.equal(
    decide(current, "read_content", null, { usage: { ...current.usage, costUsd: Number.NaN } }).outcome,
    "blocked",
  );
  assert.equal(
    decide(current, "read_content", null, { usage: { ...current.usage, elapsedMs: Number.POSITIVE_INFINITY } }).outcome,
    "blocked",
  );
  const infiniteLimit = { ...current, budget: { ...current.budget, modelCalls: Number.POSITIVE_INFINITY } };
  const nanLimit = { ...current, budget: { ...current.budget, tokens: Number.NaN } };
  const negativeLimit = { ...current, budget: { ...current.budget, costUsd: -1 } };
  const enlarged = { ...current, budget: { ...current.budget, modelCalls: current.budget.modelCalls + 1 } };
  assert.equal(decide(infiniteLimit, "read_content").outcome, "blocked");
  assert.equal(decide(nanLimit, "read_content").outcome, "blocked");
  assert.equal(decide(negativeLimit, "read_content").outcome, "blocked");
  assert.equal(decide(enlarged, "read_content").outcome, "blocked");
  assert.equal(
    decide(current, "read_content", null, {
      usage: { ...current.usage, concurrentSessions: current.budget.concurrentSessions },
    }).outcome,
    "blocked",
  );
  const exhausted = { ...current, usage: { ...current.usage, modelCalls: current.budget.modelCalls } };
  assert.throws(() => openSession({ ...evaluation(exhausted, "read_content"), sessionId: "session-budget" }), /cannot start/);
  const usedForbiddenRepair = { ...current, usage: { ...current.usage, repairs: 1 } };
  const usedForbiddenFile = { ...current, usage: { ...current.usage, fileChanges: 1 } };
  assert.equal(decide(usedForbiddenRepair, "read_content").outcome, "blocked");
  assert.equal(decide(usedForbiddenFile, "read_content").outcome, "blocked");
});

test("owner approval does not increase the specialist budget", () => {
  const waiting = transitionTask(task("engineering", ["merge_main"]), "awaiting_approval", now);
  const evidence = approval();
  assert.throws(() => applyOwnerApproval(waiting, evidence, now), /Untrusted approval/);
  const approved = { ...waiting, state: "approved" as const };
  assert.equal(approved.budget.modelCalls, limits.modelCalls);
  const enlarged = { ...approved, budget: { ...approved.budget, costUsd: approved.budget.costUsd + 1 } };
  assert.equal(decide(enlarged, "merge_main", evidence).outcome, "blocked");
});

test("cancelled tasks and substituted sessions cannot resume", () => {
  const evidence = approval();
  const { task: current, session } = runningEngineering();
  const cancelled = evaluateRecovery({
    task: { ...current, state: "cancelled" },
    session,
    operation: "merge_main",
    approval: evidence,
    now,
    isolationSatisfied: true,
  });
  assert.equal(cancelled.eligible, false);
  const substituted = evaluateRecovery({
    task: current,
    session: { ...session, taskId: "task-2", externalSessionRef: "bc-other" },
    operation: "merge_main",
    approval: evidence,
    now,
    isolationSatisfied: true,
  });
  assert.equal(substituted.eligible, false);
  const otherAdapter = evaluateRecovery({
    task: current,
    session: { ...session, adapterId: "marketing-service" },
    operation: "merge_main",
    approval: evidence,
    now,
    isolationSatisfied: true,
  });
  assert.equal(otherAdapter.eligible, false);
  const revoked = evaluateRecovery({
    task: current,
    session,
    operation: "merge_main",
    approval: approval({ revokedAt: now }),
    now,
    isolationSatisfied: true,
  });
  assert.equal(revoked.eligible, false);
  const exhausted = evaluateRecovery({
    task: { ...current, usage: { ...current.usage, tokens: current.budget.tokens } },
    session,
    operation: "merge_main",
    approval: evidence,
    now,
    isolationSatisfied: true,
  });
  assert.equal(exhausted.eligible, false);
  if (!exhausted.eligible) assert.match(exhausted.reason, /Token budget/);
});

test("recovery fails closed without a current lease held by this session", () => {
  const evidence = approval();
  const { task: current, session } = runningEngineering();
  const cases = [
    { ...current, lease: null },
    { ...current, lease: { holderSessionId: session.id, expiresAt: "not-a-timestamp" } },
    { ...current, lease: { holderSessionId: session.id, expiresAt: earlier } },
    { ...current, lease: { holderSessionId: "session-newer", expiresAt: later } },
    { ...current, idempotencyKey: "" },
  ];
  for (const candidate of cases) {
    assert.equal(
      evaluateRecovery({
        task: candidate,
        session,
        operation: "merge_main",
        approval: evidence,
        now,
        isolationSatisfied: true,
      }).eligible,
      false,
    );
  }
  const readable = runningMarketing();
  const spent = { ...readable.task, usage: { ...readable.task.usage, modelCalls: 2 } };
  const recovered = evaluateRecovery({
    task: spent,
    session: readable.session,
    operation: "read_content",
    approval: null,
    now,
    isolationSatisfied: true,
  });
  assert.equal(recovered.eligible, true);
  if (recovered.eligible) {
    assert.equal(recovered.taskId, spent.id);
    assert.equal(recovered.usage.modelCalls, 2);
    assert.equal(recovered.budget.modelCalls, spent.budget.modelCalls);
  }
});

test("evidence from another session or a failure cannot verify completion", () => {
  const current = { ...approvedSafe(), sessionId: "session-1", validationRequired: true };
  assert.throws(
    () =>
      acceptEvidence(
        {
          id: "evidence-foreign",
          taskId: current.id,
          sessionId: "session-2",
          kind: "work_completed",
          source: "executor",
          createdAt: now,
          verification: "verified",
          artifactRef: "notes/result.txt",
        },
        current,
      ),
    /session reference/,
  );
  const unbound = { ...current, sessionId: null };
  assert.throws(
    () =>
      acceptEvidence(
        {
          id: "evidence-unbound",
          taskId: unbound.id,
          sessionId: "session-2",
          kind: "work_completed",
          source: "executor",
          createdAt: now,
          verification: "verified",
          artifactRef: "notes/result.txt",
        },
        unbound,
      ),
    /session reference/,
  );
  assert.throws(
    () =>
      acceptEvidence(
        {
          id: "evidence-kind",
          taskId: current.id,
          sessionId: current.sessionId,
          kind: "success" as EvidenceRecord["kind"],
          source: "executor",
          createdAt: now,
          verification: "verified",
          artifactRef: null,
        },
        current,
      ),
    /kind/,
  );
  assert.throws(
    () =>
      acceptEvidence(
        {
          id: "evidence-source",
          taskId: current.id,
          sessionId: current.sessionId,
          kind: "proposed",
          source: "agent" as EvidenceRecord["source"],
          createdAt: now,
          verification: "unverified",
          artifactRef: null,
        },
        current,
      ),
    /source/,
  );
  const failed = acceptEvidence(
    {
      id: "evidence-failed",
      taskId: current.id,
      sessionId: current.sessionId,
      kind: "validation_failed",
      source: "validator",
      createdAt: now,
      verification: "verified",
      artifactRef: "notes/result.txt",
    },
    current,
  );
  assert.equal(failed.verification, "unverified");
  const modelValidation = acceptEvidence(
    {
      id: "evidence-model-validation",
      taskId: current.id,
      sessionId: current.sessionId,
      kind: "validation_passed",
      source: "model",
      createdAt: now,
      verification: "verified",
      artifactRef: "notes/result.txt",
    },
    current,
  );
  assert.equal(modelValidation.verification, "unverified");
  const work = verifiedWork(current, "evidence-owned");
  assert.equal(hasVerifiedCompletion(current, [work, failed, modelValidation]), false);
  assert.equal(hasVerifiedCompletion(unbound, [work]), false);
  const foreignRecord: EvidenceRecord = { ...work, id: "evidence-copy", sessionId: "session-2" };
  assert.equal(hasVerifiedCompletion(current, [foreignRecord]), false);
});

test("cancelled tasks cannot execute", () => {
  const cancelled = transitionTask(approvedSafe(), "cancelled", now);
  assert.equal(decide(cancelled, "read_content").outcome, "blocked");
  assert.throws(() => enterExecution(evaluation(cancelled, "read_content")), SupervisorContractError);
  assert.throws(() => completeTask(cancelled, [], now), /Only a running task/);
});
