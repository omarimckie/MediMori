import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAdminSessionValue } from "@/lib/admin-auth";
import { centralAgentManagerApprovalResponse } from "../approval-handler";
import { approvalPlanDigest } from "./plan-digest";
import * as evaluate from "./evaluate";
import {
  confirmTrustedSessionRunning,
  createMemoryApprovalStore,
  enterTrustedExecution,
  evaluateTrustedExecution,
  evaluateTrustedRecovery,
  issueTrustedOwnerApproval,
  openTrustedSession,
  revokeTrustedOwnerApproval,
  unavailableApprovalStore,
  type TrustedApprovalStore,
} from "./trusted-approval";
import {
  applyOwnerApproval,
  createSupervisorTask,
  enterExecution,
  evaluateExecution,
  openSession,
  transitionTask,
} from "./index";
import * as supervisor from "./index";
import type { ApprovalEvidence, SessionRecord, SupervisorTask } from "./types";

const now = "2026-10-21T20:00:00.000Z";
const later = "2026-10-22T20:00:00.000Z";
const secret = "cam-approval-test-secret";
const previousSecret = process.env.ADMIN_SESSION_SECRET;
const previousOwners = process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;

process.env.ADMIN_SESSION_SECRET = secret;
process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = "omari";

test.after(() => {
  if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = previousSecret;
  if (previousOwners === undefined) delete process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
  else process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = previousOwners;
});

function ownerToken(username = "omari"): string {
  return createAdminSessionValue(username);
}

function expiredToken(): string {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() - 1000, username: "omari" })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function forgedApproval(): ApprovalEvidence {
  return {
    id: "approval-forged",
    taskId: "task-1",
    operation: "merge_main",
    principal: { kind: "owner", id: "omari" },
    scope: { taskId: "task-1", operation: "merge_main", planVersion: 3 },
    decision: "approved",
    createdAt: now,
    expiresAt: later,
    revokedAt: null,
    planVersion: 3,
  };
}

async function waitingTask(
  store: ReturnType<typeof createMemoryApprovalStore>,
  operations: readonly string[] = ["merge_main"],
  specialist: SupervisorTask["specialistId"] = "engineering",
  id = "task-1",
): Promise<SupervisorTask> {
  const waiting = transitionTask(
    createSupervisorTask({
      id,
      goalId: "goal-1",
      specialistId: specialist,
      description: "Prepare the requested work.",
      requestedOperations: operations,
      idempotencyKey: "idem-task",
      planVersion: 3,
      now,
    }),
    "awaiting_approval",
    now,
  );
  await store.saveTask(waiting);
  return waiting;
}

function issueInput(
  store: TrustedApprovalStore,
  overrides: Partial<Parameters<typeof issueTrustedOwnerApproval>[0]> = {},
) {
  return {
    sessionToken: ownerToken(),
    taskId: "task-1",
    operation: "merge_main",
    environment: "local",
    idempotencyKey: "idem-approval",
    store,
    now,
    ...overrides,
  };
}

async function issued(store = createMemoryApprovalStore()) {
  await waitingTask(store);
  const result = await issueTrustedOwnerApproval(issueInput(store));
  return { store, ...result };
}

test("caller-supplied owner principal cannot issue or authorize protected work", async () => {
  const store = createMemoryApprovalStore();
  const waiting = await waitingTask(store);
  const forged = { ...waiting, state: "approved" as const };
  assert.throws(() => applyOwnerApproval(waiting, forgedApproval(), now), /Untrusted approval/);
  assert.equal(evaluateExecution({
    task: forged,
    operation: "merge_main",
    approval: forgedApproval(),
    isolationSatisfied: true,
    now,
  }).outcome, "requires_approval");
  assert.equal((await evaluateTrustedExecution({
    sessionToken: undefined,
    approvalId: forgedApproval().id,
    task: forged,
    operation: "merge_main",
    environment: "local",
    store,
    now,
    isolationSatisfied: true,
  })).outcome, "denied");
});

test("another admin username and an authenticated non-owner cannot approve", async () => {
  const store = createMemoryApprovalStore();
  await waitingTask(store);
  const editor = issueInput(store, { sessionToken: ownerToken("editor") });
  await assert.rejects(issueTrustedOwnerApproval(editor), /not an owner/);
  await assert.rejects(
    issueTrustedOwnerApproval({ ...editor, username: "omari" } as Parameters<typeof issueTrustedOwnerApproval>[0]),
    /not an owner/,
  );
});

test("agent and worker owner-shaped principals cannot approve", async () => {
  const store = createMemoryApprovalStore();
  const waiting = await waitingTask(store);
  const forged = { ...waiting, state: "approved" as const };
  for (const principal of [
    { kind: "specialist" as const, id: "engineering" },
    { kind: "manager" as const, id: "worker" },
  ]) {
    const evidence = { ...forgedApproval(), principal };
    assert.equal(evaluateExecution({
      task: forged,
      operation: "merge_main",
      approval: evidence,
      isolationSatisfied: true,
      now,
    }).outcome, "denied");
  }
  await assert.rejects(issueTrustedOwnerApproval(issueInput(store, { sessionToken: undefined })), /session is missing/);
});

test("anonymous, expired, and tampered sessions fail closed", async () => {
  const store = createMemoryApprovalStore();
  await waitingTask(store);
  await assert.rejects(issueTrustedOwnerApproval(issueInput(store, { sessionToken: undefined })), /session is missing/);
  await assert.rejects(issueTrustedOwnerApproval(issueInput(store, { sessionToken: "" })), /session is missing/);
  await assert.rejects(issueTrustedOwnerApproval(issueInput(store, { sessionToken: expiredToken() })), /session is missing/);
  await assert.rejects(
    issueTrustedOwnerApproval(issueInput(store, { sessionToken: `${ownerToken()}x` })),
    /session is missing/,
  );
});

test("genuine owner approval is stored and verifies only the bound operation", async () => {
  const { store, record, task } = await issued();
  assert.equal(record.ownerUsername, "omari");
  assert.equal(record.taskId, "task-1");
  assert.equal(record.operation, "merge_main");
  assert.equal(record.planVersion, 3);
  assert.equal(record.specialistId, "engineering");
  assert.equal(record.environment, "local");
  assert.equal(task.state, "approved");
  const allowed = await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: record.id,
    task,
    operation: "merge_main",
    environment: "local",
    store,
    now,
    isolationSatisfied: true,
  });
  assert.equal(allowed.outcome, "allowed");
  const otherOperation = await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: record.id,
    task,
    operation: "production_deploy",
    environment: "local",
    store,
    now,
    isolationSatisfied: true,
  });
  assert.equal(otherOperation.outcome, "denied");
});

test("approval substitution across task, plan, specialist, and environment fails", async () => {
  const { store, record, task } = await issued();
  const base = {
    sessionToken: ownerToken(),
    approvalId: record.id,
    operation: "merge_main",
    environment: "local",
    store,
    now,
    isolationSatisfied: true,
  };
  assert.equal((await evaluateTrustedExecution({ ...base, task: { ...task, id: "task-2" } })).outcome, "denied");
  assert.equal((await evaluateTrustedExecution({ ...base, task: { ...task, planVersion: 4 } })).outcome, "denied");
  assert.equal((await evaluateTrustedExecution({
    ...base,
    task: { ...task, specialistId: "marketing" },
  })).outcome, "denied");
  assert.equal((await evaluateTrustedExecution({ ...base, task, environment: "production" })).outcome, "denied");
  assert.equal((await evaluateTrustedExecution({ ...base, task, approvalId: "approval-missing" })).outcome, "denied");
  assert.equal((await evaluateTrustedExecution({ ...base, task, approvalId: "bad id" })).outcome, "denied");
});

test("expired, malformed, and revoked approvals fail at execution time", async () => {
  const expiredStore = createMemoryApprovalStore();
  await waitingTask(expiredStore);
  const expired = await issueTrustedOwnerApproval(issueInput(expiredStore));
  assert.equal((await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: expired.record.id,
    task: expired.task,
    operation: "merge_main",
    environment: "local",
    store: expiredStore,
    now: later,
    isolationSatisfied: true,
  })).outcome, "denied");

  const corrupt = createMemoryApprovalStore();
  await waitingTask(corrupt);
  corrupt.corruptNextExpiry();
  const malformed = await issueTrustedOwnerApproval(issueInput(corrupt));
  assert.equal((await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: malformed.record.id,
    task: malformed.task,
    operation: "merge_main",
    environment: "local",
    store: corrupt,
    now,
    isolationSatisfied: true,
  })).outcome, "denied");

  const { store, record, task } = await issued();
  const before = await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: record.id,
    task,
    operation: "merge_main",
    environment: "local",
    store,
    now,
    isolationSatisfied: true,
  });
  assert.equal(before.outcome, "allowed");
  await revokeTrustedOwnerApproval({ sessionToken: ownerToken(), approvalId: record.id, store, now });
  const after = await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: record.id,
    task,
    operation: "merge_main",
    environment: "local",
    store,
    now,
    isolationSatisfied: true,
  });
  assert.equal(after.outcome, "denied");
  await assert.rejects(
    enterTrustedExecution({
      sessionToken: ownerToken(),
      approvalId: record.id,
      task,
      operation: "merge_main",
      environment: "local",
      store,
      now,
      isolationSatisfied: true,
    }),
    /revoked/,
  );
});

test("approval expiry between session open and work start fails closed", async () => {
  const { store, record, task } = await issued();
  const input = {
    sessionToken: ownerToken(),
    approvalId: record.id,
    task,
    operation: "merge_main",
    environment: "local",
    store,
    now,
    isolationSatisfied: true,
  };
  const opened = await openTrustedSession({ ...input, sessionId: "session-1" });
  await assert.rejects(
    confirmTrustedSessionRunning(
      { ...opened, externalSessionRef: "bc-session-1" },
      { ...input, now: later },
    ),
    /expired/,
  );
});

test("interrupted commit, conflicts, replay, and plan changes fail closed", async () => {
  const interrupted = createMemoryApprovalStore();
  await waitingTask(interrupted);
  interrupted.failNextCommit();
  await assert.rejects(issueTrustedOwnerApproval(issueInput(interrupted)), /did not commit/);
  assert.equal(await interrupted.readApproval("approval-idem-approval"), null);

  const conflict = createMemoryApprovalStore();
  await waitingTask(conflict, ["merge_main", "production_deploy"]);
  const results = await Promise.allSettled([
    issueTrustedOwnerApproval(issueInput(conflict, { idempotencyKey: "idem-a" })),
    issueTrustedOwnerApproval(issueInput(conflict, { idempotencyKey: "idem-b" })),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);

  const replay = createMemoryApprovalStore();
  await waitingTask(replay, ["merge_main", "production_deploy"]);
  const first = await issueTrustedOwnerApproval(issueInput(replay, { idempotencyKey: "idem-replay" }));
  const second = await issueTrustedOwnerApproval(issueInput(replay, { idempotencyKey: "idem-replay" }));
  assert.equal(second.record.id, first.record.id);
  await assert.rejects(
    issueTrustedOwnerApproval(issueInput(replay, { idempotencyKey: "idem-replay", operation: "production_deploy" })),
    /conflicts/,
  );

  const changed = createMemoryApprovalStore();
  await waitingTask(changed);
  changed.bumpPlanOnNextCommit();
  await assert.rejects(issueTrustedOwnerApproval(issueInput(changed)), /plan changed/);
  assert.equal(await changed.readApproval("approval-idem-approval"), null);

  const { store, record, task } = await issued();
  const moved = { ...task, planVersion: 4 };
  await assert.rejects(store.saveTask(moved), /bound/);
  await store.rewriteTaskForTest(moved);
  assert.equal((await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: record.id,
    task: moved,
    operation: "merge_main",
    environment: "local",
    store,
    now,
    isolationSatisfied: true,
  })).outcome, "denied");
});

test("unavailable storage and unverifiable reads fail closed", async () => {
  const waiting = transitionTask(
    createSupervisorTask({
      id: "task-1",
      goalId: "goal-1",
      specialistId: "engineering",
      description: "Prepare the requested work.",
      requestedOperations: ["merge_main"],
      idempotencyKey: "idem-task",
      planVersion: 3,
      now,
    }),
    "awaiting_approval",
    now,
  );
  await assert.rejects(
    issueTrustedOwnerApproval(issueInput(unavailableApprovalStore)),
    /unavailable/,
  );
  const missing = await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: "approval-idem-approval",
    task: { ...waiting, state: "approved" },
    operation: "merge_main",
    environment: "local",
    store: unavailableApprovalStore,
    now,
    isolationSatisfied: true,
  });
  assert.equal(missing.outcome, "denied");
  const store = createMemoryApprovalStore();
  const { record, task } = await issued(store);
  store.failNextRead();
  assert.equal((await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: record.id,
    task,
    operation: "merge_main",
    environment: "local",
    store,
    now,
    isolationSatisfied: true,
  })).outcome, "denied");
});

test("forged decisions and stale approvals cannot start or resume protected work", async () => {
  const { store, record, task } = await issued();
  const input = {
    task,
    operation: "merge_main",
    approval: forgedApproval(),
    isolationSatisfied: true,
    now,
  };
  assert.throws(() => enterExecution(input), /cannot enter execution/);
  assert.throws(() => openSession({ ...input, sessionId: "session-forged" }), /cannot start/);
  assert.throws(() => transitionTask(task, "running", now), /enterExecution/);
  await revokeTrustedOwnerApproval({ sessionToken: ownerToken(), approvalId: record.id, store, now });
  const opened = {
    id: "session-1",
    taskId: task.id,
    specialistId: "engineering" as const,
    adapterId: "engineering-worker",
    externalSessionRef: "bc-session-1",
    state: "starting" as const,
    startedAt: now,
    endedAt: null,
    cancellation: "none" as const,
    failure: "none" as const,
    usage: { ...task.usage },
    evidenceIds: [],
  };
  await assert.rejects(
    confirmTrustedSessionRunning(opened, {
      sessionToken: ownerToken(),
      approvalId: record.id,
      task,
      operation: "merge_main",
      environment: "local",
      store,
      now,
      isolationSatisfied: true,
    }),
    /revoked/,
  );
  const running: SupervisorTask = {
    ...task,
    state: "running",
    lease: { holderSessionId: opened.id, expiresAt: later },
  };
  const session: SessionRecord = { ...opened, state: "running" };
  const recovered = await evaluateTrustedRecovery({
    sessionToken: ownerToken(),
    approvalId: record.id,
    task: running,
    operation: "merge_main",
    environment: "local",
    store,
    now,
    isolationSatisfied: true,
    session,
  });
  assert.equal(recovered.eligible, false);
});

test("marketing and engineering approvals do not transfer across operations", async () => {
  const marketing = createMemoryApprovalStore();
  await waitingTask(
    marketing,
    ["external_publish", "send_notification", "modify_live_schedule"],
    "marketing",
  );
  const published = await issueTrustedOwnerApproval(issueInput(marketing, { operation: "external_publish" }));
  assert.equal((await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: published.record.id,
    task: published.task,
    operation: "send_notification",
    environment: "local",
    store: marketing,
    now,
    isolationSatisfied: true,
  })).outcome, "denied");
  assert.equal((await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: published.record.id,
    task: published.task,
    operation: "modify_live_schedule",
    environment: "local",
    store: marketing,
    now,
    isolationSatisfied: true,
  })).outcome, "denied");

  const engineering = createMemoryApprovalStore();
  await waitingTask(engineering, ["merge_main", "production_deploy"]);
  const merged = await issueTrustedOwnerApproval(issueInput(engineering));
  assert.equal((await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: merged.record.id,
    task: merged.task,
    operation: "production_deploy",
    environment: "local",
    store: engineering,
    now,
    isolationSatisfied: true,
  })).outcome, "denied");
});

test("trusted execution still enforces budget, isolation, and non-protected policy", async () => {
  const { store, record, task } = await issued();
  const exhausted = {
    ...task,
    usage: { ...task.usage, modelCalls: task.budget.modelCalls },
  };
  assert.equal((await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: record.id,
    task: exhausted,
    operation: "merge_main",
    environment: "local",
    store,
    now,
    isolationSatisfied: true,
  })).outcome, "blocked");
  assert.equal((await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: record.id,
    task,
    operation: "merge_main",
    environment: "local",
    store,
    now,
    isolationSatisfied: false,
  })).outcome, "blocked");

  const readable = transitionTask(
    createSupervisorTask({
      id: "task-read",
      goalId: "goal-1",
      specialistId: "marketing",
      description: "Prepare the requested work.",
      requestedOperations: ["read_content"],
      idempotencyKey: "idem-read",
      planVersion: 3,
      now,
    }),
    "awaiting_approval",
    now,
  );
  const { markPolicyEligible } = await import("./task");
  const eligible = markPolicyEligible(readable, now);
  assert.equal(evaluateExecution({
    task: eligible,
    operation: "read_content",
    approval: null,
    isolationSatisfied: true,
    now,
  }).outcome, "allowed");
});

test("a different owner cannot reuse another owner's approval", async () => {
  const previous = process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES;
  process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = "omari,dale";
  try {
    const { store, record, task } = await issued();
    const decision = await evaluateTrustedExecution({
      sessionToken: ownerToken("dale"),
      approvalId: record.id,
      task,
      operation: "merge_main",
      environment: "local",
      store,
      now,
      isolationSatisfied: true,
    });
    assert.equal(decision.outcome, "denied");
  } finally {
    process.env.CENTRAL_AGENT_MANAGER_OWNER_USERNAMES = previous;
  }
});

test("approval route fails closed without a durable store", async () => {
  const requestBody = JSON.stringify({
    taskId: "task-1",
    operation: "merge_main",
    idempotencyKey: "idem-approval",
    principal: { kind: "owner", id: "omari" },
  });
  const unauthenticated = await centralAgentManagerApprovalResponse(
    new Request("https://manager.local/api/admin/central-agent-manager/approvals", { method: "POST", body: requestBody }),
    {
    isEnabled: () => true,
    isOwnerConfigured: () => true,
    environment: "local",
    getSessionToken: async () => undefined,
    store: unavailableApprovalStore,
    now,
  });
  assert.equal(unauthenticated.status, 401);
  const owner = await centralAgentManagerApprovalResponse(
    new Request("https://manager.local/api/admin/central-agent-manager/approvals", { method: "POST", body: requestBody }),
    {
    isEnabled: () => true,
    isOwnerConfigured: () => true,
    environment: "local",
    getSessionToken: async () => ownerToken(),
    store: unavailableApprovalStore,
    now,
  });
  assert.equal(owner.status, 503);
  const routeSource = readFileSync(
    new URL("../../../app/api/admin/central-agent-manager/approvals/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(routeSource, /unavailableApprovalStore/);
  assert.doesNotMatch(routeSource, /assertApprovalDatabaseIdentity|getSql\(/);
});

test("server digest, rollback, and immutable approval bindings", async () => {
  const fakeDigest = "ab".repeat(32);
  const store = createMemoryApprovalStore();
  await waitingTask(store);
  const issuedApproval = await issueTrustedOwnerApproval({
    ...issueInput(store),
    planDigest: fakeDigest,
    ownerUsername: "dale",
  } as Parameters<typeof issueTrustedOwnerApproval>[0]);
  assert.equal(issuedApproval.record.ownerUsername, "omari");
  assert.equal(issuedApproval.task.state, "approved");
  assert.notEqual(issuedApproval.record.planDigest, fakeDigest);
  assert.equal(issuedApproval.record.planDigest, approvalPlanDigest({
    task: issuedApproval.task,
    operation: "merge_main",
    environment: "local",
  }));
  assert.equal((await store.readApproval(issuedApproval.record.id))?.planDigest, issuedApproval.record.planDigest);

  const widened = {
    ...issuedApproval.task,
    requestedOperations: ["merge_main", "production_deploy"],
    allowedCapabilityScope: ["merge_main", "production_deploy"],
  };
  assert.equal(widened.planVersion, issuedApproval.task.planVersion);
  assert.notEqual(approvalPlanDigest({
    task: widened,
    operation: "merge_main",
    environment: "local",
  }), issuedApproval.record.planDigest);
  await assert.rejects(store.saveTask(widened), /bound/);
  await store.rewriteTaskForTest(widened);
  assert.equal((await evaluateTrustedExecution({
    sessionToken: ownerToken(),
    approvalId: issuedApproval.record.id,
    task: widened,
    operation: "merge_main",
    environment: "local",
    store,
    now,
    isolationSatisfied: true,
  })).outcome, "denied");

  const revoked = await revokeTrustedOwnerApproval({
    sessionToken: ownerToken(),
    approvalId: issuedApproval.record.id,
    store,
    now,
  });
  await assert.rejects(revokeTrustedOwnerApproval({
    sessionToken: ownerToken(),
    approvalId: issuedApproval.record.id,
    store,
    now: later,
  }), /permanent/);
  await assert.rejects(store.rewriteApprovalForTest({ ...revoked, revokedAt: null }), /permanent/);
  await assert.rejects(
    store.rewriteApprovalForTest({ ...revoked, operation: "production_deploy" }),
    /immutable/,
  );
  const stored = await store.readApproval(issuedApproval.record.id);
  assert.equal(stored?.revokedAt, now);
  assert.equal(stored?.operation, "merge_main");
  assert.equal(stored?.planDigest, issuedApproval.record.planDigest);

  const direct = createMemoryApprovalStore();
  const waiting = await waitingTask(direct);
  await assert.rejects(direct.commitApproval({
    id: "approval-direct",
    taskId: waiting.id,
    operation: "merge_main",
    planVersion: waiting.planVersion,
    specialistId: waiting.specialistId,
    environment: "local",
    ownerUsername: "omari",
    decision: "approved",
    issuedAt: now,
    expiresAt: later,
    revokedAt: null,
    idempotencyKey: "idem-direct",
    expectedPlanVersion: waiting.planVersion,
    expectedPlanDigest: fakeDigest,
    expectedTaskPlanDigest: fakeDigest,
  }), /plan changed/);
  assert.equal(await direct.readApproval("approval-direct"), null);
  assert.equal((await direct.readTask(waiting.id))?.state, "awaiting_approval");

  const rollback = createMemoryApprovalStore();
  await waitingTask(rollback);
  rollback.failBeforePublish();
  await assert.rejects(issueTrustedOwnerApproval(issueInput(rollback)), /did not commit/);
  assert.equal(await rollback.readApproval("approval-idem-approval"), null);
  assert.equal((await rollback.readTask("task-1"))?.state, "awaiting_approval");

  const created = createMemoryApprovalStore();
  await created.saveTask(createSupervisorTask({
    id: "task-1",
    goalId: "goal-1",
    specialistId: "engineering",
    description: "Prepare the requested work.",
    requestedOperations: ["merge_main"],
    idempotencyKey: "idem-task",
    planVersion: 3,
    now,
  }));
  await assert.rejects(issueTrustedOwnerApproval(issueInput(created)), /awaiting/);
  assert.equal(await created.readApproval("approval-idem-approval"), null);
  assert.equal((await created.readTask("task-1"))?.state, "created");

  const missing = createMemoryApprovalStore();
  await assert.rejects(issueTrustedOwnerApproval(issueInput(missing)), /missing/);
  assert.equal(await missing.readApproval("approval-idem-approval"), null);

  const racing = createMemoryApprovalStore();
  await waitingTask(racing, ["merge_main", "production_deploy"]);
  const raced = await Promise.allSettled([
    issueTrustedOwnerApproval(issueInput(racing, { idempotencyKey: "idem-a" })),
    issueTrustedOwnerApproval(issueInput(racing, { idempotencyKey: "idem-b" })),
  ]);
  assert.equal(raced.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await racing.readTask("task-1"))?.state, "approved");
  const live = [await racing.readApproval("approval-idem-a"), await racing.readApproval("approval-idem-b")]
    .filter((record) => record?.revokedAt === null);
  assert.equal(live.length, 1);
});

test("replay after revocation or expiry is not a live approval", async () => {
  const revoked = createMemoryApprovalStore();
  await waitingTask(revoked);
  const issuedApproval = await issueTrustedOwnerApproval(issueInput(revoked));
  await revokeTrustedOwnerApproval({
    sessionToken: ownerToken(),
    approvalId: issuedApproval.record.id,
    store: revoked,
    now,
  });
  await assert.rejects(issueTrustedOwnerApproval(issueInput(revoked)), /revoked/);
  await assert.rejects(revoked.markTaskRunning({
    taskId: issuedApproval.task.id,
    operation: "merge_main",
    environment: "local",
    now,
    usage: issuedApproval.task.usage,
  }), /revoked/);
  assert.equal((await revoked.readTask(issuedApproval.task.id))?.state, "approved");

  const expired = createMemoryApprovalStore();
  await waitingTask(expired);
  const expiring = await issueTrustedOwnerApproval(issueInput(expired));
  await assert.rejects(
    issueTrustedOwnerApproval({ ...issueInput(expired), now: later }),
    /expired/,
  );
  await assert.rejects(expired.markTaskRunning({
    taskId: expiring.task.id,
    operation: "merge_main",
    environment: "local",
    now: later,
    usage: expiring.task.usage,
  }), /expired/);
  const widened = {
    ...expiring.task,
    requestedOperations: ["merge_main", "production_deploy"],
    allowedCapabilityScope: ["merge_main", "production_deploy"],
  };
  await expired.rewriteTaskForTest(widened);
  await assert.rejects(expired.markTaskRunning({
    taskId: widened.id,
    operation: "merge_main",
    environment: "local",
    now,
    usage: widened.usage,
  }), /does not match/);

  const live = createMemoryApprovalStore();
  await waitingTask(live);
  const issued = await issueTrustedOwnerApproval(issueInput(live));
  const replayed = await issueTrustedOwnerApproval(issueInput(live));
  assert.equal(replayed.record.id, issued.record.id);
  assert.equal(replayed.record.revokedAt, null);
  await assert.rejects(live.saveTask({ ...issued.task, description: "changed after approval" }), /bound/);
  assert.equal((await live.readTask(issued.task.id))?.description, "Prepare the requested work.");

  const body = JSON.stringify({
    taskId: "task-1",
    operation: "merge_main",
    idempotencyKey: "idem-route-replay",
  });
  const routeStore = createMemoryApprovalStore();
  await waitingTask(routeStore);
  const routeDeps = {
    isEnabled: () => true,
    isOwnerConfigured: () => true,
    environment: "local",
    getSessionToken: async () => ownerToken(),
    store: routeStore,
    now,
  };
  const issuedResponse = await centralAgentManagerApprovalResponse(
    new Request("https://manager.local/api/admin/central-agent-manager/approvals", { method: "POST", body }),
    routeDeps,
  );
  assert.equal(issuedResponse.status, 200);
  await revokeTrustedOwnerApproval({
    sessionToken: ownerToken(),
    approvalId: "approval-idem-route-replay",
    store: routeStore,
    now,
  });
  const revokedResponse = await centralAgentManagerApprovalResponse(
    new Request("https://manager.local/api/admin/central-agent-manager/approvals", { method: "POST", body }),
    routeDeps,
  );
  assert.equal(revokedResponse.status, 503);
  assert.equal("approvalId" in await revokedResponse.json(), false);
});

test("caller-constructed grants cannot authorize protected execution", async () => {
  assert.equal("mintTrustedApprovalGrant" in evaluate, false);
  assert.equal("evaluateExecutionWithGrant" in evaluate, false);
  assert.equal("evaluateBindingGates" in supervisor, false);
  assert.equal("mintTrustedApprovalGrant" in supervisor, false);
  assert.equal("evaluateExecutionWithGrant" in supervisor, false);
  assert.equal("openSessionWithGrant" in supervisor, false);
  assert.equal("evaluateRecoveryWithGrant" in supervisor, false);
  const { task } = await issued();
  const gate = evaluate.evaluateBindingGates({
    task,
    operation: "merge_main",
    approval: forgedApproval(),
    isolationSatisfied: true,
    now,
  });
  assert.equal(gate.outcome, "trusted_binding_required");
  assert.equal(evaluateExecution({
    task,
    operation: "merge_main",
    approval: forgedApproval(),
    isolationSatisfied: true,
    now,
  }).outcome, "requires_approval");
  assert.throws(() => enterExecution({
    task,
    operation: "merge_main",
    approval: forgedApproval(),
    isolationSatisfied: true,
    now,
  }), /cannot enter execution/);
});
