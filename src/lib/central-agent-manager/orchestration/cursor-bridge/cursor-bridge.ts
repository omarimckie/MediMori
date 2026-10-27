import type { AgentConsumerHandlerDeps } from "../../agent-consumer-handler";
import { isCursorBridgeEnabled } from "../flags";
import {
  effectiveCursorDispatchState,
  reconcileUnresolvedDispatchIntentOnResume,
} from "../cursor-dispatch-intent";
import { jobRequiresLiveOwnerApproval } from "../approval-integration";
import { hasConfirmedCursorExternalIds } from "../external-execution-refs";
import type { MemoryOrchestrationQueueStore } from "../memory-queue-store";
import { createMockSpecialistHarness } from "../mock-specialist-agent";
import type { ProjectId } from "../../types";
import type { CursorCloudApiTransport } from "./cursor-cloud-api-transport";
import { CursorBridgeConsumerClient } from "./cursor-bridge-consumer-client";
import type { CursorBridgeConsumerPort } from "./cursor-bridge-consumer-port";
import type { CursorBridgeConfig } from "./cursor-bridge-config";
import { resolveProjectTarget, validateCursorBridgeConfig } from "./cursor-bridge-config";
import { CursorBridgeDispatchRegistry } from "./cursor-bridge-dispatch-registry";
import { pollCursorRunUntilTerminal } from "./cursor-bridge-polling";
import { handleCursorCreateFailure } from "./cursor-bridge-recovery";
import { CURSOR_BRIDGE_CONTRACT_V1, type CursorBridgeRunResult } from "./cursor-bridge-types";
import {
  loadCursorBridgePollingConfigFromEnv,
  type CursorBridgePollingConfig,
} from "./cursor-rest-config";

export type CursorBridgeDeps = {
  bridgeEnabled?: () => boolean;
  transport: CursorCloudApiTransport;
  config: CursorBridgeConfig;
  store: MemoryOrchestrationQueueStore;
  /** When durable reload swaps memory, return the current store snapshot for reads after await. */
  liveStore?: () => MemoryOrchestrationQueueStore;
  consumer: CursorBridgeConsumerPort;
  shouldAbort?: () => boolean;
  /** Durable cross-process dispatch owner token (8–80 chars). */
  dispatchOwnerId: string;
  dispatchRegistry?: CursorBridgeDispatchRegistry;
  maxPollIterations?: number;
  polling?: CursorBridgePollingConfig;
  sleep?: (ms: number) => Promise<void>;
  now: () => string;
  bearerToken: string;
  /** Called immediately before createAgentWithInitialRun; must durably reserve daily create budget. */
  reserveExternalCreateBudget?: () => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildPrompt(config: CursorBridgeConfig, jobDescription: string, projectId: ProjectId): string {
  const template =
    config.promptTemplate ??
    "Execute the Central Agent Manager assignment for project {{projectId}}:\n{{description}}";
  return template.replace("{{projectId}}", projectId).replace("{{description}}", jobDescription);
}

function loadAssignmentRecord(store: MemoryOrchestrationQueueStore, assignmentId: string) {
  const assignment = store.listAssignmentsSync().find((row) => row.id === assignmentId);
  if (!assignment) {
    throw new Error("Cursor bridge lost assignment record.");
  }
  return assignment;
}

export function createCursorBridgeHarness(input: {
  store: MemoryOrchestrationQueueStore;
  config: CursorBridgeConfig;
  bearerToken: string;
  now: () => string;
  agentId?: string;
  dispatchOwnerId?: string;
}): {
  handlerDeps: AgentConsumerHandlerDeps;
  client: CursorBridgeConsumerPort;
  dispatchOwnerId: string;
} {
  const config = validateCursorBridgeConfig(input.config);
  const agentId = input.agentId ?? config.specialistAgentId;
  const dispatchOwnerId = input.dispatchOwnerId ?? `bridge-${agentId}`;
  const { handlerDeps } = createMockSpecialistHarness({
    store: input.store,
    agentId,
    bearerToken: input.bearerToken,
    now: input.now,
  });
  const client = new CursorBridgeConsumerClient({
    agentId,
    bearerToken: input.bearerToken,
    handlerDeps,
  });
  return { handlerDeps, client, dispatchOwnerId };
}

/**
 * Runs one Cursor bridge cycle: CAM claim → durable dispatch intent → fake/real Cursor create → correlate → poll → complete.
 * Does not retry failed Cursor creates (fail-closed on CAM assignment).
 */
function activeOrchestrationStore(deps: CursorBridgeDeps): MemoryOrchestrationQueueStore {
  return deps.liveStore?.() ?? deps.store;
}

export async function runCursorBridgeAssignmentCycle(deps: CursorBridgeDeps): Promise<CursorBridgeRunResult | null> {
  const bridgeEnabled = deps.bridgeEnabled ?? isCursorBridgeEnabled;
  if (!bridgeEnabled()) {
    throw new Error("Cursor bridge is disabled.");
  }
  const config = validateCursorBridgeConfig(deps.config);
  const registry = deps.dispatchRegistry ?? new CursorBridgeDispatchRegistry();
  const now = deps.now();

  const claim = await deps.consumer.claim();
  if (claim.status !== 200 || !claim.assignment) {
    return null;
  }
  const store = activeOrchestrationStore(deps);
  const claimedJob = store.getJobSync(claim.assignment.jobId);
  if (claimedJob && jobRequiresLiveOwnerApproval(claimedJob, now)) {
    return null;
  }
  const assignmentView = claim.assignment;
  let assignment = reconcileUnresolvedDispatchIntentOnResume(store, assignmentView.id, now);
  if (!assignment) {
    throw new Error("Cursor bridge lost assignment record after claim.");
  }
  if (assignment.state === "ambiguous") {
    throw new Error("Assignment requires operator recovery before Cursor bridge can continue.");
  }

  const job = store.getJobSync(assignmentView.jobId);
  if (!job) {
    throw new Error("Cursor bridge claimed assignment without a job record.");
  }

  registry.assertCanDispatch(assignmentView.id);

  const dispatchState = effectiveCursorDispatchState(assignment.cursorDispatchIntent);
  let cursorAgentId =
    assignment.externalRefs?.cursorAgentId ?? job.externalRefs?.cursorAgentId ?? undefined;
  let cursorRunId = assignment.externalRefs?.cursorRunId ?? job.externalRefs?.cursorRunId ?? undefined;

  const confirmed =
    hasConfirmedCursorExternalIds(assignment.externalRefs) ||
    hasConfirmedCursorExternalIds(job.externalRefs) ||
    dispatchState === "external_confirmed";

  let externalCreatePerformed = false;

  if (!confirmed) {
    if (dispatchState === "recovery_required" || dispatchState === "dispatch_failed") {
      throw new Error("External dispatch is blocked for this assignment.");
    }
    if (dispatchState === "dispatch_in_progress" || dispatchState === "outcome_unknown") {
      throw new Error("External dispatch outcome is unresolved; operator recovery is required.");
    }
    const beginStatus = await deps.consumer.beginExternalDispatch(
      assignmentView,
      deps.dispatchOwnerId,
    );
    if (beginStatus !== 200) {
      throw new Error(`Failed to record external dispatch intent (status ${beginStatus}).`);
    }
    assignment = loadAssignmentRecord(activeOrchestrationStore(deps), assignmentView.id);
    const target = resolveProjectTarget(config, job.projectId);
    try {
      if (deps.reserveExternalCreateBudget) {
        await deps.reserveExternalCreateBudget();
      }
      const created = await deps.transport.createAgentWithInitialRun({
        promptText: buildPrompt(config, job.description, job.projectId),
        repoUrl: target.repoUrl,
        startingRef: target.startingRef,
        correlationKey: job.externalRefs?.correlationKey,
      });
      cursorAgentId = created.agentId;
      cursorRunId = created.runId;
      externalCreatePerformed = true;
    } catch (error) {
      return await handleCursorCreateFailure({
        consumer: deps.consumer,
        assignment: assignmentView,
        error,
        clearRegistry: () => registry.clear(assignmentView.id),
      });
    }
    if (!cursorAgentId || !cursorRunId) {
      throw new Error("Cursor create did not return ids.");
    }
    registry.recordDispatch(assignmentView.id, cursorAgentId, cursorRunId);
    const correlateStatus = await deps.consumer.correlateExternal(assignmentView, {
      cursorAgentId,
      cursorRunId,
    });
    if (correlateStatus !== 200) {
      await deps.consumer.escalateExternalDispatchRecovery(
        assignmentView,
        "Cursor ids could not be persisted after external create.",
      );
      registry.clear(assignmentView.id);
      throw new Error(`Cursor correlation failed with status ${correlateStatus}.`);
    }
  } else {
    if (!cursorAgentId || !cursorRunId) {
      await deps.consumer.escalateExternalDispatchRecovery(
        assignmentView,
        "External dispatch confirmed without cursor ids.",
      );
      throw new Error("External dispatch confirmed without cursor ids.");
    }
    registry.recordDispatch(assignmentView.id, cursorAgentId, cursorRunId);
  }

  if (!cursorAgentId || !cursorRunId) {
    throw new Error("External dispatch confirmed without cursor ids.");
  }

  const workEvidenceId = `ev-cursor-work-${assignmentView.id}`;
  const assignmentRecord = loadAssignmentRecord(activeOrchestrationStore(deps), assignmentView.id);
  const polling = deps.polling ?? loadCursorBridgePollingConfigFromEnv();
  const sleep = deps.sleep ?? defaultSleep;
  const nowMs = () => Date.parse(deps.now());

  let terminalSnapshot: Awaited<ReturnType<CursorCloudApiTransport["getRun"]>>;
  try {
    terminalSnapshot = await pollCursorRunUntilTerminal({
      transport: deps.transport,
      consumer: deps.consumer,
      assignment: assignmentView,
      cursorAgentId,
      cursorRunId,
      leaseExpiresAt: assignmentRecord.lease.expiresAt,
      polling,
      now: nowMs,
      sleep,
      maxPollIterations: deps.maxPollIterations,
      shouldAbort: deps.shouldAbort,
      onUnknownRunStatus: async () => {
        await deps.consumer.escalateExternalDispatchRecovery(
          assignmentView,
          "Cursor run reported an unknown status.",
        );
        registry.clear(assignmentView.id);
      },
      onLeaseExpired: async () => {
        await deps.consumer.escalateExternalDispatchRecovery(
          assignmentView,
          "CAM assignment lease expired during Cursor polling.",
        );
        registry.clear(assignmentView.id);
      },
      onPollLimitExceeded: async () => {
        await deps.consumer.escalateExternalDispatchRecovery(
          assignmentView,
          "Cursor run polling exceeded bridge bound.",
        );
        registry.clear(assignmentView.id);
      },
    });
  } catch (error) {
    if (error instanceof Error && /polling exceeded|lease expired/i.test(error.message)) {
      throw error;
    }
    registry.clear(assignmentView.id);
    throw error;
  }

  if (terminalSnapshot.status !== "FINISHED") {
    const reason = (terminalSnapshot.diagnostic ?? terminalSnapshot.status).slice(0, 240);
    await deps.consumer.fail(assignmentView, reason);
    registry.clear(assignmentView.id);
    throw new Error(reason);
  }

  const workStatus = await deps.consumer.submitEvidence(assignmentView, {
    id: workEvidenceId,
    kind: "work_completed",
    artifactRef: terminalSnapshot.artifactPath ?? "artifacts/cursor-bridge/outcome.json",
    diagnostic: terminalSnapshot.diagnostic,
  });
  if (workStatus !== 200) {
    registry.clear(assignmentView.id);
    throw new Error(`Cursor bridge work evidence failed with status ${workStatus}.`);
  }

  const complete = await deps.consumer.complete(assignmentView, [workEvidenceId]);
  registry.clear(assignmentView.id);
  if (complete.status !== 200 || complete.jobState !== "completed") {
    throw new Error(
      `Cursor bridge completion failed (status ${complete.status}, jobState ${complete.jobState ?? "unknown"}).`,
    );
  }

  const updatedJob = activeOrchestrationStore(deps).getJobSync(assignmentView.jobId);
  if (!updatedJob || updatedJob.state !== "completed") {
    throw new Error("CAM job did not reach completed after Cursor bridge cycle.");
  }

  return {
    contractVersion: CURSOR_BRIDGE_CONTRACT_V1,
    agentId: deps.consumer.agentId,
    assignmentId: assignmentView.id,
    jobId: assignmentView.jobId,
    cursorAgentId,
    cursorRunId,
    evidenceIds: [workEvidenceId],
    jobState: updatedJob.state,
    externalCreatePerformed,
  };
}
