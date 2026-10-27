import { emptyUsage } from "../supervisor/types";
import { getSpecialistProfile } from "../supervisor/registry";
import type { SpecialistId } from "../supervisor/types";
import { SupervisorContractError } from "../supervisor/types";
import type { ProjectId } from "../types";
import {
  attachAssignmentToAgent,
  detachAssignmentFromAgent,
  observeAgent,
} from "./agent-capacity";
import {
  completeAssignmentSuccess,
  failAssignment,
  markAssignmentAmbiguous,
  releaseExpiredLease,
} from "./assignment-lifecycle";
import { applyApprovalBinding, classifyOwnerAuthorizationScope, gateJobForApproval } from "./approval-integration";
import {
  ORCHESTRATION_JOB_CONTRACT_V1,
  type JobApprovalBinding,
  type JobProvenance,
  type ManagerAgentRecord,
  type ManagerAssignmentRecord,
  type ManagerJobRecord,
} from "./contracts-v1";
import type { ExternalExecutionReferences } from "./external-execution-refs";
import { validateExternalExecutionReferences } from "./external-execution-refs";
import { markJobReadyFromDependencies, transitionManagerJob } from "./job-state";
import { assertRecoverFromCrashSafe, recoverOrchestrationState } from "./crash-recovery";
import { OrchestrationEvidenceStore } from "./orchestration-evidence";
import {
  appendPersistedEvidenceToAssignment,
  rehydrateEvidenceStoreFromAssignments,
  reconcileUnverifiableCompletedJobs,
} from "./orchestration-evidence-lifecycle";
import type { OrchestrationEvidenceRecord } from "./orchestration-evidence";
import type { CrashRecoveryReport, OrchestrationQueuePort } from "./orchestration-queue-port";
import { runSchedulerTick, type SchedulerTickResult } from "./scheduler";

let jobSequence = 0;

export type EnqueueJobInput = {
  id: string;
  projectId: ProjectId;
  goalId: string;
  description: string;
  priority?: number;
  dependsOnJobIds?: readonly string[];
  requiredCapabilities?: readonly string[];
  requestedOperation?: string | null;
  specialistId?: SpecialistId;
  supervisorTaskId?: string | null;
  maxAttempts?: number;
  retryEligible?: boolean;
  provenance: JobProvenance;
  externalRefs?: ExternalExecutionReferences;
  now: string;
};

export class MemoryOrchestrationQueueStore implements OrchestrationQueuePort {
  evidenceStore = new OrchestrationEvidenceStore();
  private jobs = new Map<string, ManagerJobRecord>();
  private assignments = new Map<string, ManagerAssignmentRecord>();
  private agents = new Map<string, ManagerAgentRecord>();
  private projectCursor = 0;
  private consumerIdempotency = new Map<string, { action: string; body: unknown }>();

  listJobsSync(): ManagerJobRecord[] {
    return [...this.jobs.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  listAssignmentsSync(): ManagerAssignmentRecord[] {
    return [...this.assignments.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  listAgentsSync(): ManagerAgentRecord[] {
    return [...this.agents.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  getJobSync(id: string): ManagerJobRecord | null {
    return this.jobs.get(id) ?? null;
  }

  registerAgentSync(agent: ManagerAgentRecord): void {
    this.agents.set(agent.id, agent);
  }

  observeAgentStatusSync(agentId: string, status: ManagerAgentRecord["status"], observedAt: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) throw new SupervisorContractError("Unknown agent.");
    this.agents.set(agentId, observeAgent(agent, { status, observedAt }));
  }

  enqueueJobSync(input: EnqueueJobInput): ManagerJobRecord {
    if (this.jobs.has(input.id)) {
      throw new SupervisorContractError("Duplicate job id.");
    }
    const specialistId = input.specialistId ?? "engineering";
    const profile = getSpecialistProfile(specialistId);
    const scope = classifyOwnerAuthorizationScope(input.requestedOperation ?? null);
    const externalRefs = validateExternalExecutionReferences(input.externalRefs);
    jobSequence += 1;
    const job: ManagerJobRecord = {
      contractVersion: ORCHESTRATION_JOB_CONTRACT_V1,
      id: input.id,
      projectId: input.projectId,
      goalId: input.goalId,
      description: input.description,
      priority: input.priority ?? 100,
      sequence: jobSequence,
      state: "queued",
      dependsOnJobIds: input.dependsOnJobIds ?? [],
      requiredCapabilities: input.requiredCapabilities ?? [],
      requestedOperation: input.requestedOperation ?? null,
      ownerAuthorizationScope: scope,
      budget: profile.defaultBudget,
      usage: emptyUsage(),
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? 3,
      retryEligible: input.retryEligible ?? true,
      assignmentId: null,
      activeLeaseFence: null,
      supervisorTaskId: input.supervisorTaskId ?? null,
      approvalBinding: null,
      evidenceIds: [],
      terminalOutcome: "none",
      failureReason: null,
      blockReason: null,
      provenance: input.provenance,
      ...(externalRefs ? { externalRefs } : {}),
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.jobs.set(job.id, job);
    this.refreshDependencyReadinessSync(input.now);
    const stored = this.jobs.get(job.id)!;
    this.jobs.set(job.id, gateJobForApproval(stored, input.now));
    return this.jobs.get(job.id)!;
  }

  bindApprovalSync(jobId: string, binding: JobApprovalBinding, now: string): ManagerJobRecord {
    const job = this.jobs.get(jobId);
    if (!job) throw new SupervisorContractError("Unknown job.");
    let next = applyApprovalBinding(job, binding, now);
    if (!binding.revokedAt && binding.approvalRecordId) {
      next = transitionManagerJob(next, "ready", { now, idempotent: true });
    }
    this.jobs.set(jobId, next);
    return next;
  }

  cancelJobSync(jobId: string, now: string): ManagerJobRecord {
    const job = this.jobs.get(jobId);
    if (!job) throw new SupervisorContractError("Unknown job.");
    const cancelled = transitionManagerJob(job, "cancelled", { now, idempotent: false });
    this.jobs.set(jobId, cancelled);
    return cancelled;
  }

  refreshDependencyReadinessSync(now: string): void {
    const completed = new Set(
      [...this.jobs.values()].filter((j) => j.state === "completed").map((j) => j.id),
    );
    for (const job of this.jobs.values()) {
      const next = markJobReadyFromDependencies(job, completed, now);
      if (next.state !== job.state || next.blockReason !== job.blockReason) {
        this.jobs.set(job.id, gateJobForApproval(next, now));
      }
    }
  }

  planSchedulerTick(now: string): SchedulerTickResult {
    this.reconcileLeasesSync(now);
    this.refreshDependencyReadinessSync(now);
    const tick = runSchedulerTick(
      this.listJobsSync(),
      this.listAgentsSync(),
      this.listAssignmentsSync(),
      { now, projectCursor: this.projectCursor },
    );
    this.projectCursor = (this.projectCursor + 1) % 5;
    return tick;
  }

  applySchedulerTick(tick: SchedulerTickResult): void {
    for (const job of tick.updatedJobs) {
      this.jobs.set(job.id, job);
    }
    for (const assignment of tick.assignments) {
      this.assignments.set(assignment.id, assignment);
      const agent = this.agents.get(assignment.agentId);
      if (agent) {
        this.agents.set(assignment.agentId, attachAssignmentToAgent(agent, assignment.id));
      }
    }
  }

  runSchedulerSync(now: string): void {
    this.applySchedulerTick(this.planSchedulerTick(now));
  }

  reconcileLeasesSync(now: string): void {
    for (const assignment of this.listAssignmentsSync()) {
      if (assignment.state !== "active") continue;
      const job = this.jobs.get(assignment.jobId);
      if (!job) continue;
      const result = releaseExpiredLease(assignment, job, now);
      if (result.assignment.state !== assignment.state) {
        this.assignments.set(assignment.id, result.assignment);
        this.jobs.set(job.id, result.job);
        const agent = this.agents.get(assignment.agentId);
        if (agent) {
          this.agents.set(assignment.agentId, detachAssignmentFromAgent(agent, assignment.id));
        }
      }
    }
  }

  reportAmbiguousOutcomeSync(assignmentId: string, now: string, reason: string): void {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) throw new SupervisorContractError("Unknown assignment.");
    const job = this.jobs.get(assignment.jobId);
    if (!job) throw new SupervisorContractError("Unknown job.");
    const result = markAssignmentAmbiguous(assignment, job, now, reason);
    this.assignments.set(assignmentId, result.assignment);
    this.jobs.set(job.id, result.job);
    const agent = this.agents.get(assignment.agentId);
    if (agent) {
      this.agents.set(assignment.agentId, detachAssignmentFromAgent(agent, assignment.id));
    }
  }

  completeAssignmentSync(
    assignmentId: string,
    now: string,
    evidenceIds: readonly string[],
    options?: { requirePersistedEvidence?: boolean },
  ): void {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) throw new SupervisorContractError("Unknown assignment.");
    if (assignment.state === "completed") return;
    const job = this.jobs.get(assignment.jobId);
    if (!job) throw new SupervisorContractError("Unknown job.");
    const validatedIds = options?.requirePersistedEvidence
      ? this.evidenceStore.assertCompletionEvidence(
          assignmentId,
          assignment.agentId,
          assignment.jobId,
          evidenceIds,
        )
      : evidenceIds;
    const result = completeAssignmentSuccess(assignment, job, now, validatedIds);
    this.assignments.set(assignmentId, result.assignment);
    this.jobs.set(job.id, result.job);
    const agent = this.agents.get(assignment.agentId);
    if (agent) {
      this.agents.set(assignment.agentId, detachAssignmentFromAgent(agent, assignment.id));
    }
    this.refreshDependencyReadinessSync(now);
  }

  failAssignmentOutcomeSync(assignmentId: string, now: string, reason: string): void {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) throw new SupervisorContractError("Unknown assignment.");
    const job = this.jobs.get(assignment.jobId);
    if (!job) throw new SupervisorContractError("Unknown job.");
    const result = failAssignment(assignment, job, now, reason);
    this.assignments.set(assignmentId, result.assignment);
    this.jobs.set(job.id, result.job);
    const agent = this.agents.get(assignment.agentId);
    if (agent) {
      this.agents.set(assignment.agentId, detachAssignmentFromAgent(agent, assignment.id));
    }
  }

  restoreJob(job: ManagerJobRecord): void {
    this.jobs.set(job.id, job);
  }

  restoreAssignment(assignment: ManagerAssignmentRecord): void {
    this.assignments.set(assignment.id, assignment);
  }

  recoverFromCrashSync(now: string): CrashRecoveryReport {
    assertRecoverFromCrashSafe(this.listAssignmentsSync());
    const recovered = recoverOrchestrationState({
      jobs: this.listJobsSync(),
      assignments: this.listAssignmentsSync(),
      now,
    });
    this.jobs = new Map(recovered.jobs.map((job) => [job.id, job]));
    this.assignments = new Map(recovered.assignments.map((row) => [row.id, row]));
    this.evidenceStore = new OrchestrationEvidenceStore();
    rehydrateEvidenceStoreFromAssignments(this);
    reconcileUnverifiableCompletedJobs(this, now);
    return recovered.report;
  }

  persistOrchestrationEvidenceSync(
    assignmentId: string,
    record: OrchestrationEvidenceRecord,
    now: string,
  ): ManagerAssignmentRecord {
    const assignment = this.assignments.get(assignmentId);
    if (!assignment) throw new SupervisorContractError("Unknown assignment.");
    this.evidenceStore.register(record);
    const updated = appendPersistedEvidenceToAssignment(assignment, record, now);
    this.assignments.set(assignmentId, updated);
    return updated;
  }

  finalizeOrchestrationLoadSync(now: string): void {
    this.evidenceStore = new OrchestrationEvidenceStore();
    rehydrateEvidenceStoreFromAssignments(this);
    reconcileUnverifiableCompletedJobs(this, now);
  }

  async listJobs(): Promise<ManagerJobRecord[]> {
    return this.listJobsSync();
  }

  async getJob(id: string): Promise<ManagerJobRecord | null> {
    return this.getJobSync(id);
  }

  async listAssignments(): Promise<ManagerAssignmentRecord[]> {
    return this.listAssignmentsSync();
  }

  async listAgents(): Promise<ManagerAgentRecord[]> {
    return this.listAgentsSync();
  }

  async enqueueJob(input: EnqueueJobInput): Promise<ManagerJobRecord> {
    return this.enqueueJobSync(input);
  }

  async cancelJob(jobId: string, now: string): Promise<ManagerJobRecord> {
    return this.cancelJobSync(jobId, now);
  }

  async bindApproval(jobId: string, binding: JobApprovalBinding, now: string): Promise<ManagerJobRecord> {
    return this.bindApprovalSync(jobId, binding, now);
  }

  async registerAgent(agent: ManagerAgentRecord): Promise<void> {
    this.registerAgentSync(agent);
  }

  async observeAgentStatus(
    agentId: string,
    status: ManagerAgentRecord["status"],
    observedAt: string,
  ): Promise<void> {
    this.observeAgentStatusSync(agentId, status, observedAt);
  }

  async refreshDependencyReadiness(now: string): Promise<void> {
    this.refreshDependencyReadinessSync(now);
  }

  async reconcileLeases(now: string): Promise<void> {
    this.reconcileLeasesSync(now);
  }

  async runScheduler(now: string): Promise<void> {
    this.runSchedulerSync(now);
  }

  async reportAmbiguousOutcome(assignmentId: string, now: string, reason: string): Promise<void> {
    this.reportAmbiguousOutcomeSync(assignmentId, now, reason);
  }

  async completeAssignment(
    assignmentId: string,
    now: string,
    evidenceIds: readonly string[],
  ): Promise<void> {
    this.completeAssignmentSync(assignmentId, now, evidenceIds);
  }

  async failAssignmentOutcome(assignmentId: string, now: string, reason: string): Promise<void> {
    this.failAssignmentOutcomeSync(assignmentId, now, reason);
  }

  async recoverFromCrash(now: string): Promise<CrashRecoveryReport> {
    return this.recoverFromCrashSync(now);
  }

  getConsumerIdempotencyRecord(key: string): { action: string; body: unknown } | null {
    return this.consumerIdempotency.get(key) ?? null;
  }

  setConsumerIdempotencyRecord(key: string, action: string, body: unknown): void {
    this.consumerIdempotency.set(key, { action, body });
  }
}
