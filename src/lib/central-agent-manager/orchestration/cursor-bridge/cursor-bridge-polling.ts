import { DEFAULT_LEASE_MS } from "../assignment-lifecycle";
import type { CursorBridgePollingConfig } from "./cursor-rest-config";
import type { CursorCloudApiTransport } from "./cursor-cloud-api-transport";
import type { CursorCloudRunSnapshot } from "./cursor-bridge-types";
import { cursorCloudTerminalRunStatuses } from "./cursor-bridge-types";
import type { CursorBridgeConsumerPort } from "./cursor-bridge-consumer-port";
import type { MockSpecialistAssignmentView } from "../mock-specialist-agent";
import { isCursorCloudApiError } from "./cursor-rest-errors";

export type PollCursorRunInput = {
  transport: CursorCloudApiTransport;
  consumer: CursorBridgeConsumerPort;
  shouldAbort?: () => boolean;
  assignment: MockSpecialistAssignmentView;
  cursorAgentId: string;
  cursorRunId: string;
  leaseExpiresAt: string;
  polling: CursorBridgePollingConfig;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  maxPollIterations?: number;
  onUnknownRunStatus?: (snapshot: CursorCloudRunSnapshot) => Promise<void>;
  onLeaseExpired?: () => Promise<void>;
  onPollLimitExceeded?: () => Promise<void>;
};

const TERMINAL = new Set<string>(cursorCloudTerminalRunStatuses);

export async function pollCursorRunUntilTerminal(
  input: PollCursorRunInput,
): Promise<CursorCloudRunSnapshot> {
  const startedAt = input.now();
  const deadline = Math.min(
    startedAt + input.polling.pollMaxDurationMs,
    Date.parse(input.leaseExpiresAt) || startedAt + DEFAULT_LEASE_MS,
  );
  const maxIterations = input.maxPollIterations ?? Number.POSITIVE_INFINITY;
  let lastHeartbeatAt = 0;

  for (let poll = 0; poll < maxIterations; poll += 1) {
    if (input.shouldAbort?.()) {
      throw new Error("Cursor bridge polling aborted by runner shutdown.");
    }
    const nowMs = input.now();
    if (nowMs >= deadline) {
      if (input.onPollLimitExceeded) await input.onPollLimitExceeded();
      throw new Error("Cursor run polling exceeded the configured duration or lease bound.");
    }
    if (nowMs >= Date.parse(input.leaseExpiresAt)) {
      if (input.onLeaseExpired) await input.onLeaseExpired();
      throw new Error("CAM assignment lease expired during Cursor polling.");
    }

    let snapshot: CursorCloudRunSnapshot;
    try {
      snapshot = await input.transport.getRun(input.cursorAgentId, input.cursorRunId);
    } catch (error) {
      if (isCursorCloudApiError(error) && error.phase === "get_run" && !error.retryable) {
        throw error;
      }
      throw error;
    }

    if (nowMs - lastHeartbeatAt >= input.polling.heartbeatMinIntervalMs) {
      const heartbeatStatus = await input.consumer.heartbeat(input.assignment, {
        artifactRef: snapshot.artifactPath,
      });
      lastHeartbeatAt = nowMs;
      if (heartbeatStatus !== 200) {
        throw new Error(`Cursor bridge heartbeat failed with status ${heartbeatStatus}.`);
      }
    }

    if (
      snapshot.status === "RUNNING" ||
      snapshot.status === "CREATING" ||
      snapshot.status === "WAITING_FOR_BACKGROUND_WORK"
    ) {
      const progressStatus = await input.consumer.submitEvidence(input.assignment, {
        id: `ev-cursor-progress-${input.assignment.id}-${poll}`,
        kind: "progress_note",
        diagnostic: snapshot.diagnostic ?? snapshot.status,
      });
      if (progressStatus !== 200) {
        throw new Error(`Cursor bridge progress evidence failed with status ${progressStatus}.`);
      }
      await input.sleep(input.polling.pollIntervalMs);
      continue;
    }

    if (TERMINAL.has(snapshot.status)) {
      return snapshot;
    }

    if (input.onUnknownRunStatus) {
      await input.onUnknownRunStatus(snapshot);
    }
    throw new Error(`Cursor run reported an unknown terminal status: ${snapshot.status}`);
  }

  if (input.onPollLimitExceeded) await input.onPollLimitExceeded();
  throw new Error("Cursor run polling exceeded the configured iteration bound.");
}
