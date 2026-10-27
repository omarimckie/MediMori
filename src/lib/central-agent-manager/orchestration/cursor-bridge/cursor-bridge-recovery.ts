import type { CursorBridgeConsumerPort } from "./cursor-bridge-consumer-port";
import type { MockSpecialistAssignmentView } from "../mock-specialist-agent";
import { isCursorCloudApiError } from "./cursor-rest-errors";

export async function handleCursorCreateFailure(input: {
  consumer: CursorBridgeConsumerPort;
  assignment: MockSpecialistAssignmentView;
  error: unknown;
  clearRegistry: () => void;
}): Promise<never> {
  const { consumer, assignment, error, clearRegistry } = input;
  if (isCursorCloudApiError(error)) {
    if (error.ambiguousCreateOutcome) {
      await consumer.markExternalDispatchOutcomeUnknown(assignment);
      await consumer.escalateExternalDispatchRecovery(
        assignment,
        "External agent create outcome is unknown; operator review is required.",
      );
      clearRegistry();
      throw new Error("External agent create outcome is unknown; operator recovery is required.");
    }
    if (error.status === 409 || error.code === "agent_busy") {
      await consumer.escalateExternalDispatchRecovery(
        assignment,
        "Cursor agent is busy (409); operator recovery is required.",
      );
      clearRegistry();
      throw new Error("Cursor agent is busy; operator recovery is required.");
    }
    if (error.status === 401 || error.status === 403) {
      const reason = "Cursor API authentication failed.";
      await consumer.markExternalDispatchFailed(assignment, reason);
      await consumer.fail(assignment, reason);
      clearRegistry();
      throw new Error(reason);
    }
  }
  const reason =
    error instanceof Error ? error.message.slice(0, 240) : "Cursor agent dispatch failed.";
  await consumer.markExternalDispatchFailed(assignment, reason);
  await consumer.fail(assignment, reason);
  clearRegistry();
  throw new Error(reason);
}
