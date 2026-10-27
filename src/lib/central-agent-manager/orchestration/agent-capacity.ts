import type { ProjectId } from "../types";
import type { ManagerAgentRecord, AgentCapacityStatus } from "./contracts-v1";

export const DEFAULT_AGENT_STALE_MS = 5 * 60 * 1000;

export function agentHasCapacity(
  agent: ManagerAgentRecord,
  nowMs: number,
  staleAfterMs = DEFAULT_AGENT_STALE_MS,
): boolean {
  if (agent.status === "unknown" || agent.status === "disconnected") return false;
  if (!agent.lastObservedAt) return false;
  const observed = Date.parse(agent.lastObservedAt);
  if (!Number.isFinite(observed) || nowMs - observed > staleAfterMs) return false;
  if (agent.activeAssignmentIds.length >= agent.maxConcurrentAssignments) return false;
  return agent.status === "available" || agent.status === "busy";
}

export function agentEligibleForProject(agent: ManagerAgentRecord, projectId: ProjectId): boolean {
  return agent.eligibleProjectIds.includes(projectId);
}

export function agentHasCapabilities(agent: ManagerAgentRecord, required: readonly string[]): boolean {
  if (!required.length) return true;
  const set = new Set(agent.capabilities);
  return required.every((cap) => set.has(cap));
}

export function observeAgent(
  agent: ManagerAgentRecord,
  observation: { status: AgentCapacityStatus; observedAt: string },
): ManagerAgentRecord {
  const busy =
    agent.activeAssignmentIds.length >= agent.maxConcurrentAssignments
      ? "busy"
      : observation.status;
  return {
    ...agent,
    status: busy,
    lastObservedAt: observation.observedAt,
  };
}

export function attachAssignmentToAgent(agent: ManagerAgentRecord, assignmentId: string): ManagerAgentRecord {
  if (agent.activeAssignmentIds.includes(assignmentId)) return agent;
  const activeAssignmentIds = [...agent.activeAssignmentIds, assignmentId];
  return {
    ...agent,
    activeAssignmentIds,
    status: activeAssignmentIds.length >= agent.maxConcurrentAssignments ? "busy" : agent.status,
  };
}

export function detachAssignmentFromAgent(agent: ManagerAgentRecord, assignmentId: string): ManagerAgentRecord {
  const activeAssignmentIds = agent.activeAssignmentIds.filter((id) => id !== assignmentId);
  return {
    ...agent,
    activeAssignmentIds,
    status:
      activeAssignmentIds.length >= agent.maxConcurrentAssignments
        ? "busy"
        : agent.status === "disconnected" || agent.status === "unknown"
          ? agent.status
          : "available",
  };
}
