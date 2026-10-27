import type { ProjectAdapterSnapshot, ProjectId } from "../types";
import {
  connectedSnapshot,
  disconnectedSnapshot,
  unavailableSnapshot,
} from "../stale";
import type { ParsedContractV1 } from "./v1";

/**
 * Pure mapping from a validated contract v1 document to the manager dashboard model.
 * Does not infer progress, timestamps, or approval requirements.
 */
export function contractV1ToAdapterSnapshot(
  contract: ParsedContractV1,
  expectedProjectId: ProjectId,
): ProjectAdapterSnapshot {
  if (contract.projectId !== expectedProjectId) {
    return unavailableSnapshot(
      expectedProjectId,
      contract.displayName,
      "Project identifier does not match adapter.",
    );
  }

  const base = {
    projectId: contract.projectId,
    displayName: contract.displayName,
    lastSuccessfulUpdate: contract.lastSuccessfulUpdate,
    activeAgents: contract.activeAgents,
    tasks: contract.workItems,
    pendingApprovals: contract.pendingApprovals,
    evidence: contract.evidence,
    source: contract.source,
  };

  switch (contract.reportingStatus) {
    case "disconnected":
      return disconnectedSnapshot(
        contract.projectId,
        contract.displayName,
        contract.statusDetail,
      );
    case "unavailable":
      return unavailableSnapshot(
        contract.projectId,
        contract.displayName,
        contract.statusDetail,
      );
    case "stale":
      return {
        ...connectedSnapshot({
          ...base,
          connectionDetail: contract.statusDetail,
        }),
        connection: "stale",
        connectionDetail: contract.statusDetail,
      };
    case "live":
    default:
      return connectedSnapshot({
        ...base,
        connectionDetail: contract.statusDetail,
      });
  }
}
