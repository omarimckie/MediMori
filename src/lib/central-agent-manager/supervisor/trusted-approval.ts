import { getAdminSessionUsername } from "@/lib/admin-auth";
import { isCentralAgentManagerOwner } from "../owner-auth";
import { applyTrustedTaskApproval } from "./approval";
import { budgetBlockReason, usageForEvaluation } from "./budget";
import { evaluateBindingGates, type EvaluationInput } from "./evaluate";
import { approvalPlanDigest, taskPlanFingerprint } from "./plan-digest";
import { requiresOwnerApproval } from "./protected-operations";
import { recoveryIdentityBlock, type RecoveryDecision, type RecoveryInput } from "./recovery";
import { getSpecialistProfile } from "./registry";
import {
  assertIdentifier,
  assertTimestamp,
  SupervisorContractError,
  type BudgetUsage,
  type SessionRecord,
  type SpecialistId,
  type SupervisorTask,
} from "./types";

const approvalTtlMs = 24 * 60 * 60 * 1000;
const environmentPattern = /^[\w.-]{1,40}$/;

export type TrustedApprovalRecord = {
  id: string;
  taskId: string;
  operation: string;
  planVersion: number;
  planDigest: string;
  taskPlanDigest: string;
  specialistId: SpecialistId;
  environment: string;
  ownerUsername: string;
  decision: "approved";
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  idempotencyKey: string;
};

export type ApprovalCommitAttempt = {
  id: string;
  taskId: string;
  operation: string;
  planVersion: number;
  specialistId: SpecialistId;
  environment: string;
  ownerUsername: string;
  decision: "approved";
  issuedAt: string;
  expiresAt: string;
  revokedAt: null;
  idempotencyKey: string;
  expectedPlanVersion: number;
  expectedPlanDigest: string;
  expectedTaskPlanDigest: string;
};

export type TaskRunningAttempt = {
  taskId: string;
  operation: string;
  environment: string;
  now: string;
  usage: BudgetUsage;
};

export type TrustedApprovalStore = {
  readTask(taskId: string): Promise<SupervisorTask | null>;
  saveTask(task: SupervisorTask): Promise<void>;
  commitApproval(attempt: ApprovalCommitAttempt): Promise<{ record: TrustedApprovalRecord; task: SupervisorTask }>;
  readApproval(id: string): Promise<TrustedApprovalRecord | null>;
  revokeApproval(id: string, now: string): Promise<TrustedApprovalRecord | null>;
  markTaskRunning(attempt: TaskRunningAttempt): Promise<SupervisorTask>;
};

const bindingKeys = [
  "id",
  "taskId",
  "operation",
  "planVersion",
  "planDigest",
  "taskPlanDigest",
  "specialistId",
  "environment",
  "ownerUsername",
  "decision",
  "issuedAt",
  "expiresAt",
  "idempotencyKey",
] as const;

export function assertApprovalMutation(existing: TrustedApprovalRecord, next: TrustedApprovalRecord): void {
  for (const key of bindingKeys) {
    if (existing[key] !== next[key]) {
      throw new SupervisorContractError("Approval binding is immutable.");
    }
  }
  if (existing.revokedAt !== null) {
    if (next.revokedAt !== existing.revokedAt) {
      throw new SupervisorContractError("Approval revocation is permanent.");
    }
    return;
  }
  if (next.revokedAt === null || (typeof next.revokedAt === "string" && next.revokedAt.length > 0)) return;
  throw new SupervisorContractError("Approval revocation is permanent.");
}

export const unavailableApprovalStore: TrustedApprovalStore = {
  async readTask() {
    throw new SupervisorContractError("Trusted approval storage is unavailable.");
  },
  async saveTask() {
    throw new SupervisorContractError("Trusted approval storage is unavailable.");
  },
  async commitApproval() {
    throw new SupervisorContractError("Trusted approval storage is unavailable.");
  },
  async readApproval() {
    throw new SupervisorContractError("Trusted approval storage is unavailable.");
  },
  async revokeApproval() {
    throw new SupervisorContractError("Trusted approval storage is unavailable.");
  },
  async markTaskRunning() {
    throw new SupervisorContractError("Trusted approval storage is unavailable.");
  },
};

export type MemoryApprovalSnapshot = {
  tasks: SupervisorTask[];
  approvals: TrustedApprovalRecord[];
  idempotency: Record<string, string>;
};

type MemoryControls = {
  failNextCommit(): void;
  failBeforePublish(): void;
  failNextRead(): void;
  bumpPlanOnNextCommit(): void;
  corruptNextExpiry(): void;
  rewriteTaskForTest(task: SupervisorTask): Promise<void>;
  rewriteApprovalForTest(record: TrustedApprovalRecord): Promise<void>;
  exportSnapshot(): Promise<MemoryApprovalSnapshot>;
  importSnapshot(snapshot: MemoryApprovalSnapshot): Promise<void>;
};

export function createMemoryApprovalStore(): TrustedApprovalStore & MemoryControls {
  let tasks = new Map<string, SupervisorTask>();
  let approvals = new Map<string, TrustedApprovalRecord>();
  let idempotency = new Map<string, string>();
  let chain: Promise<unknown> = Promise.resolve();
  let failCommit = false;
  let failBefore = false;
  let failRead = false;
  let bumpPlan = false;
  let corruptExpiry = false;

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work, work);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function liveApproval(taskId: string): boolean {
    for (const record of approvals.values()) {
      if (record.taskId === taskId && record.revokedAt === null) return true;
    }
    return false;
  }

  function sameBinding(
    existing: TrustedApprovalRecord,
    attempt: ApprovalCommitAttempt,
    planDigest: string,
    taskPlanDigest: string,
  ): boolean {
    return (
      existing.taskId === attempt.taskId &&
      existing.operation === attempt.operation &&
      existing.planVersion === attempt.planVersion &&
      existing.planDigest === planDigest &&
      existing.taskPlanDigest === taskPlanDigest &&
      existing.specialistId === attempt.specialistId &&
      existing.environment === attempt.environment &&
      existing.ownerUsername === attempt.ownerUsername &&
      existing.idempotencyKey === attempt.idempotencyKey &&
      existing.decision === "approved"
    );
  }

  return {
    failNextCommit() {
      failCommit = true;
    },
    failBeforePublish() {
      failBefore = true;
    },
    failNextRead() {
      failRead = true;
    },
    bumpPlanOnNextCommit() {
      bumpPlan = true;
    },
    corruptNextExpiry() {
      corruptExpiry = true;
    },
    rewriteTaskForTest(task) {
      return exclusive(async () => {
        tasks.set(task.id, structuredClone(task));
      });
    },
    rewriteApprovalForTest(record) {
      return exclusive(async () => {
        const existing = approvals.get(record.id);
        if (!existing) throw new SupervisorContractError("Approval record is unknown.");
        assertApprovalMutation(existing, record);
        approvals.set(record.id, structuredClone(record));
      });
    },
    readTask(taskId) {
      return exclusive(async () => {
        if (failRead) {
          failRead = false;
          throw new SupervisorContractError("Trusted approval storage is unavailable.");
        }
        const task = tasks.get(taskId);
        return task ? structuredClone(task) : null;
      });
    },
    saveTask(task) {
      return exclusive(async () => {
        const existing = tasks.get(task.id);
        if (existing && liveApproval(task.id)) {
          throw new SupervisorContractError("Task plan is bound to an approval.");
        }
        tasks.set(task.id, structuredClone(task));
      });
    },
    commitApproval(attempt) {
      return exclusive(async () => {
        if (failCommit) {
          failCommit = false;
          throw new SupervisorContractError("Approval issuance did not commit.");
        }
        const current = tasks.get(attempt.taskId);
        if (!current) throw new SupervisorContractError("Task state is missing.");
        if (bumpPlan) {
          bumpPlan = false;
          current.planVersion += 1;
          tasks.set(current.id, structuredClone(current));
        }
        const locked = tasks.get(attempt.taskId);
        if (!locked) throw new SupervisorContractError("Task state is missing.");
        if (locked.specialistId !== attempt.specialistId) {
          throw new SupervisorContractError("Task plan changed during approval.");
        }
        const planDigest = approvalPlanDigest({
          task: locked,
          operation: attempt.operation,
          environment: attempt.environment,
        });
        const taskPlanDigest = taskPlanFingerprint(locked);
        if (
          locked.planVersion !== attempt.expectedPlanVersion ||
          locked.planVersion !== attempt.planVersion ||
          planDigest !== attempt.expectedPlanDigest ||
          taskPlanDigest !== attempt.expectedTaskPlanDigest
        ) {
          throw new SupervisorContractError("Task plan changed during approval.");
        }
        const existingId = idempotency.get(attempt.idempotencyKey);
        if (existingId) {
          const existing = approvals.get(existingId);
          if (!existing || !sameBinding(existing, attempt, planDigest, taskPlanDigest)) {
            throw new SupervisorContractError("Approval idempotency key conflicts with another issuance.");
          }
          if (existing.revokedAt) throw new SupervisorContractError("Trusted approval is revoked.");
          const replayExpires = Date.parse(existing.expiresAt);
          if (!Number.isFinite(replayExpires) || replayExpires <= Date.parse(attempt.issuedAt)) {
            throw new SupervisorContractError("Trusted approval is expired.");
          }
          return { record: structuredClone(existing), task: structuredClone(locked) };
        }
        if (locked.state !== "awaiting_approval") {
          throw new SupervisorContractError("Owner approval applies only to a task awaiting approval.");
        }
        for (const record of approvals.values()) {
          if (
            record.revokedAt === null &&
            record.taskId === attempt.taskId &&
            record.operation === attempt.operation &&
            record.planVersion === attempt.planVersion
          ) {
            throw new SupervisorContractError("A conflicting approval is already recorded.");
          }
        }
        const issuedMs = Date.parse(attempt.issuedAt);
        const expiresMs = Date.parse(attempt.expiresAt);
        if (
          !Number.isFinite(issuedMs) ||
          !Number.isFinite(expiresMs) ||
          expiresMs <= issuedMs ||
          expiresMs > issuedMs + approvalTtlMs
        ) {
          throw new SupervisorContractError("Approval expiry is outside the server window.");
        }
        const approved = applyTrustedTaskApproval(structuredClone(locked), attempt.issuedAt);
        if (failBefore) {
          failBefore = false;
          throw new SupervisorContractError("Approval issuance did not commit.");
        }
        const record: TrustedApprovalRecord = {
          id: attempt.id,
          taskId: attempt.taskId,
          operation: attempt.operation,
          planVersion: locked.planVersion,
          planDigest,
          taskPlanDigest,
          specialistId: locked.specialistId,
          environment: attempt.environment,
          ownerUsername: attempt.ownerUsername,
          decision: "approved",
          issuedAt: attempt.issuedAt,
          expiresAt: corruptExpiry ? "not-a-timestamp" : attempt.expiresAt,
          revokedAt: null,
          idempotencyKey: attempt.idempotencyKey,
        };
        corruptExpiry = false;
        const nextApprovals = new Map(approvals);
        const nextTasks = new Map(tasks);
        const nextKeys = new Map(idempotency);
        nextApprovals.set(record.id, structuredClone(record));
        nextTasks.set(approved.id, structuredClone(approved));
        nextKeys.set(record.idempotencyKey, record.id);
        approvals = nextApprovals;
        tasks = nextTasks;
        idempotency = nextKeys;
        return { record: structuredClone(record), task: structuredClone(approved) };
      });
    },
    readApproval(id) {
      return exclusive(async () => {
        if (failRead) {
          failRead = false;
          throw new SupervisorContractError("Trusted approval storage is unavailable.");
        }
        const record = approvals.get(id);
        return record ? structuredClone(record) : null;
      });
    },
    markTaskRunning(attempt) {
      return exclusive(async () => {
        assertTimestamp(attempt.now, "Execution time");
        const task = tasks.get(attempt.taskId);
        if (!task) throw new SupervisorContractError("Task state is missing.");
        if (task.state !== "approved") {
          throw new SupervisorContractError("Protected or ineligible work cannot enter execution.");
        }
        const planDigest = approvalPlanDigest({
          task,
          operation: attempt.operation,
          environment: attempt.environment,
        });
        const taskPlanDigest = taskPlanFingerprint(task);
        const candidates = [...approvals.values()].filter(
          (record) =>
            record.taskId === task.id &&
            record.operation === attempt.operation &&
            record.environment === attempt.environment &&
            record.planVersion === task.planVersion &&
            record.planDigest === planDigest &&
            record.taskPlanDigest === taskPlanDigest &&
            record.specialistId === task.specialistId &&
            record.decision === "approved",
        );
        const nowMs = Date.parse(attempt.now);
        const live = candidates.find((record) => {
          const expires = Date.parse(record.expiresAt);
          return record.revokedAt === null && Number.isFinite(expires) && expires > nowMs;
        });
        if (!live) {
          if (candidates.some((record) => record.revokedAt)) {
            throw new SupervisorContractError("Trusted approval is revoked.");
          }
          if (candidates.length > 0) throw new SupervisorContractError("Trusted approval is expired.");
          throw new SupervisorContractError("Trusted approval does not match this task.");
        }
        const running = { ...task, usage: attempt.usage, state: "running" as const, updatedAt: attempt.now };
        if (taskPlanFingerprint(running) !== taskPlanDigest) {
          throw new SupervisorContractError("Task plan is bound to an approval.");
        }
        tasks.set(task.id, structuredClone(running));
        return structuredClone(running);
      });
    },
    revokeApproval(id, now) {
      return exclusive(async () => {
        const record = approvals.get(id);
        if (!record) return null;
        if (record.revokedAt) throw new SupervisorContractError("Approval revocation is permanent.");
        const next = { ...record, revokedAt: now };
        assertApprovalMutation(record, next);
        const nextApprovals = new Map(approvals);
        nextApprovals.set(id, structuredClone(next));
        approvals = nextApprovals;
        return structuredClone(next);
      });
    },
    exportSnapshot() {
      return exclusive(async () => ({
        tasks: [...tasks.values()].map((task) => structuredClone(task)),
        approvals: [...approvals.values()].map((record) => structuredClone(record)),
        idempotency: Object.fromEntries(idempotency.entries()),
      }));
    },
    importSnapshot(snapshot) {
      return exclusive(async () => {
        tasks = new Map(snapshot.tasks.map((task) => [task.id, structuredClone(task)]));
        approvals = new Map(snapshot.approvals.map((record) => [record.id, structuredClone(record)]));
        idempotency = new Map(Object.entries(snapshot.idempotency));
      });
    },
  };
}

export type IssueTrustedApprovalInput = {
  sessionToken: string | undefined;
  taskId: string;
  operation: string;
  environment: string;
  idempotencyKey: string;
  store: TrustedApprovalStore;
  now: string;
};

function authenticatedOwner(sessionToken: string | undefined): string {
  let username: string | null = null;
  try {
    username = getAdminSessionUsername(sessionToken);
  } catch {
    throw new SupervisorContractError("Authenticated owner session is missing.");
  }
  if (!username) throw new SupervisorContractError("Authenticated owner session is missing.");
  if (!isCentralAgentManagerOwner(username)) {
    throw new SupervisorContractError("Authenticated admin is not an owner.");
  }
  return username;
}

function serverExpiry(now: string): string {
  assertTimestamp(now, "Approval time");
  return new Date(Date.parse(now) + approvalTtlMs).toISOString();
}

export async function issueTrustedOwnerApproval(
  input: IssueTrustedApprovalInput,
): Promise<{ record: TrustedApprovalRecord; task: SupervisorTask }> {
  const ownerUsername = authenticatedOwner(input.sessionToken);
  assertIdentifier(input.taskId, "Task id");
  assertIdentifier(input.idempotencyKey, "Idempotency key");
  assertIdentifier(input.operation, "Operation");
  if (!environmentPattern.test(input.environment)) {
    throw new SupervisorContractError("Approval environment is not configured.");
  }
  if (!requiresOwnerApproval(input.operation)) {
    throw new SupervisorContractError("Trusted owner approval applies only to a protected operation.");
  }
  const stored = await input.store.readTask(input.taskId);
  if (!stored) throw new SupervisorContractError("Task state is missing.");
  const profile = getSpecialistProfile(stored.specialistId);
  if (
    profile.absoluteProhibitions.includes(input.operation) ||
    !profile.requestableOperations.includes(input.operation) ||
    !stored.requestedOperations.includes(input.operation)
  ) {
    throw new SupervisorContractError("Approval cannot override a specialist prohibition.");
  }
  const planInput = { task: stored, operation: input.operation, environment: input.environment };
  return input.store.commitApproval({
    id: `approval-${input.idempotencyKey}`,
    taskId: stored.id,
    operation: input.operation,
    planVersion: stored.planVersion,
    specialistId: stored.specialistId,
    environment: input.environment,
    ownerUsername,
    decision: "approved",
    issuedAt: input.now,
    expiresAt: serverExpiry(input.now),
    revokedAt: null,
    idempotencyKey: input.idempotencyKey,
    expectedPlanVersion: stored.planVersion,
    expectedPlanDigest: approvalPlanDigest(planInput),
    expectedTaskPlanDigest: taskPlanFingerprint(stored),
  });
}

export async function revokeTrustedOwnerApproval(input: {
  sessionToken: string | undefined;
  approvalId: string;
  store: TrustedApprovalStore;
  now: string;
}): Promise<TrustedApprovalRecord> {
  authenticatedOwner(input.sessionToken);
  assertIdentifier(input.approvalId, "Approval id");
  assertTimestamp(input.now, "Revocation time");
  const record = await input.store.revokeApproval(input.approvalId, input.now);
  if (!record) throw new SupervisorContractError("Approval record is unknown.");
  return record;
}

type VerificationInput = {
  sessionToken: string | undefined;
  approvalId: string;
  task: SupervisorTask;
  operation: string;
  environment: string;
  store: TrustedApprovalStore;
  now: string;
};

async function readVerified(
  input: VerificationInput,
): Promise<{ ok: true; task: SupervisorTask; record: TrustedApprovalRecord } | { ok: false; reason: string }> {
  let ownerUsername: string;
  try {
    ownerUsername = authenticatedOwner(input.sessionToken);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Authenticated owner session is missing." };
  }
  if (!environmentPattern.test(input.environment)) {
    return { ok: false, reason: "Approval environment is not configured." };
  }
  if (!/^[\w.-]{1,80}$/.test(input.approvalId)) {
    return { ok: false, reason: "Approval record id is malformed." };
  }
  let record: TrustedApprovalRecord | null;
  let stored: SupervisorTask | null;
  try {
    record = await input.store.readApproval(input.approvalId);
    stored = await input.store.readTask(input.task.id);
  } catch {
    return { ok: false, reason: "Approval record cannot be independently verified." };
  }
  if (!record) return { ok: false, reason: "Approval record is unknown." };
  if (!stored) return { ok: false, reason: "Task state is missing." };
  const expires = Date.parse(record.expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.parse(input.now)) {
    return { ok: false, reason: "Trusted approval is expired." };
  }
  if (record.revokedAt) return { ok: false, reason: "Trusted approval is revoked." };
  if (record.decision !== "approved") return { ok: false, reason: "Trusted approval was rejected." };
  if (record.ownerUsername !== ownerUsername) {
    return { ok: false, reason: "Trusted approval belongs to another owner." };
  }
  if (
    record.taskId !== input.task.id ||
    record.taskId !== stored.id ||
    record.operation !== input.operation ||
    record.planVersion !== input.task.planVersion ||
    record.planVersion !== stored.planVersion ||
    record.specialistId !== input.task.specialistId ||
    record.specialistId !== stored.specialistId ||
    record.environment !== input.environment
  ) {
    return { ok: false, reason: "Trusted approval does not match this task." };
  }
  try {
    const storedDigest = approvalPlanDigest({
      task: stored,
      operation: record.operation,
      environment: record.environment,
    });
    const presentedDigest = approvalPlanDigest({
      task: input.task,
      operation: input.operation,
      environment: input.environment,
    });
    const storedFingerprint = taskPlanFingerprint(stored);
    const presentedFingerprint = taskPlanFingerprint(input.task);
    if (
      storedDigest !== record.planDigest ||
      presentedDigest !== record.planDigest ||
      storedFingerprint !== record.taskPlanDigest ||
      presentedFingerprint !== record.taskPlanDigest
    ) {
      return { ok: false, reason: "Trusted approval does not match this task." };
    }
  } catch {
    return { ok: false, reason: "Trusted approval does not match this task." };
  }
  let usage = stored.usage;
  try {
    usage = usageForEvaluation(stored.usage, input.task.usage);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Required usage data is unavailable." };
  }
  return { ok: true, task: { ...stored, usage }, record };
}

function evaluationFrom(input: VerificationInput & { isolationSatisfied: boolean }, task: SupervisorTask): EvaluationInput {
  return {
    task,
    operation: input.operation,
    approval: null,
    isolationSatisfied: input.isolationSatisfied,
    now: input.now,
  };
}

function continueVerified(input: VerificationInput & { isolationSatisfied: boolean }, task: SupervisorTask) {
  const gate = evaluateBindingGates(evaluationFrom(input, task));
  if (gate.outcome === "trusted_binding_required") return { outcome: "allowed" as const };
  return gate;
}

export async function evaluateTrustedExecution(
  input: VerificationInput & { isolationSatisfied: boolean },
): Promise<ReturnType<typeof continueVerified>> {
  const verified = await readVerified(input);
  if (!verified.ok) return { outcome: "denied", reason: verified.reason };
  return continueVerified(input, verified.task);
}

export async function enterTrustedExecution(
  input: VerificationInput & { isolationSatisfied: boolean },
): Promise<SupervisorTask> {
  const verified = await readVerified(input);
  if (!verified.ok) throw new SupervisorContractError(verified.reason);
  const decision = continueVerified(input, verified.task);
  if (verified.task.state !== "approved" || decision.outcome !== "allowed") {
    throw new SupervisorContractError("Protected or ineligible work cannot enter execution.");
  }
  return input.store.markTaskRunning({
    taskId: verified.task.id,
    operation: input.operation,
    environment: input.environment,
    now: input.now,
    usage: verified.task.usage,
  });
}

function startingSession(input: EvaluationInput & { sessionId: string }): SessionRecord {
  assertIdentifier(input.sessionId, "Session id");
  const profile = getSpecialistProfile(input.task.specialistId);
  return {
    id: input.sessionId,
    taskId: input.task.id,
    specialistId: input.task.specialistId,
    adapterId: profile.adapterId,
    externalSessionRef: null,
    state: "starting",
    startedAt: input.now,
    endedAt: null,
    cancellation: "none",
    failure: "none",
    usage: { ...input.task.usage },
    evidenceIds: [],
  };
}

export async function openTrustedSession(
  input: VerificationInput & { isolationSatisfied: boolean; sessionId: string },
): Promise<SessionRecord> {
  const verified = await readVerified(input);
  if (!verified.ok) throw new SupervisorContractError(verified.reason);
  const evaluation = evaluationFrom(input, verified.task);
  const decision = continueVerified(input, verified.task);
  if (verified.task.state !== "approved" || decision.outcome !== "allowed") {
    throw new SupervisorContractError("Session cannot start without task eligibility.");
  }
  return startingSession({ ...evaluation, sessionId: input.sessionId });
}

export async function confirmTrustedSessionRunning(
  session: SessionRecord,
  input: VerificationInput & { isolationSatisfied: boolean },
): Promise<SessionRecord> {
  const verified = await readVerified(input);
  if (!verified.ok) throw new SupervisorContractError(verified.reason);
  const decision = continueVerified(input, verified.task);
  if (session.taskId !== verified.task.id || session.specialistId !== verified.task.specialistId) {
    throw new SupervisorContractError("Session does not belong to this task.");
  }
  if (session.state !== "starting" && session.state !== "waiting_for_approval") {
    throw new SupervisorContractError("Session cannot enter running from this state.");
  }
  const profile = getSpecialistProfile(verified.task.specialistId);
  if (session.adapterId !== profile.adapterId) {
    throw new SupervisorContractError("Session adapter does not match the specialist profile.");
  }
  if (decision.outcome !== "allowed") {
    throw new SupervisorContractError("Session cannot run without a fresh eligibility decision.");
  }
  return { ...session, state: "running" };
}

export async function evaluateTrustedRecovery(
  input: VerificationInput & { isolationSatisfied: boolean; session: RecoveryInput["session"] },
): Promise<RecoveryDecision> {
  const verified = await readVerified(input);
  if (!verified.ok) return { eligible: false, reason: verified.reason };
  const task = { ...input.task, usage: verified.task.usage, budget: verified.task.budget };
  const identity = recoveryIdentityBlock({
    task,
    session: input.session,
    operation: input.operation,
    approval: null,
    now: input.now,
    isolationSatisfied: input.isolationSatisfied,
  });
  if (identity) return { eligible: false, reason: identity };
  const profile = getSpecialistProfile(task.specialistId);
  const budget = budgetBlockReason(task.budget, task.usage, profile.defaultBudget);
  if (budget) return { eligible: false, reason: budget };
  const gate = evaluateBindingGates({
    task: { ...task, state: "approved" },
    operation: input.operation,
    approval: null,
    isolationSatisfied: input.isolationSatisfied,
    now: input.now,
  });
  if (gate.outcome !== "trusted_binding_required" && gate.outcome !== "allowed") {
    return { eligible: false, reason: gate.reason };
  }
  return {
    eligible: true,
    taskId: task.id,
    idempotencyKey: task.idempotencyKey,
    budget: { ...task.budget },
    usage: { ...task.usage },
  };
}
