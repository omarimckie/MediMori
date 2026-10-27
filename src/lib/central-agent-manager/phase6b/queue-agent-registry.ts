import type { ManagerAgentRecord } from "../orchestration/contracts-v1";
import type { MemoryOrchestrationQueueStore } from "../orchestration/memory-queue-store";
import {
  resolveSpecialistTemplate,
  type SpecialistTemplateRole,
} from "../phase6a/specialist-template-registry";
import type { ProjectId as PolicyProjectId } from "../phase6a/project-policy";
import type { ProjectId as OrchestrationProjectId } from "../types";

export const PHASE6B_AGENT_PREFIX = "cam6b-agent-" as const;

export function orchestrationProjectId(policyProjectId: PolicyProjectId): OrchestrationProjectId {
  return policyProjectId === "twilight_feather" ? "twilight-feather" : policyProjectId;
}

export function agentIdForRole(role: SpecialistTemplateRole): string {
  return `${PHASE6B_AGENT_PREFIX}${role}`;
}

export function buildPhase6bAgent(role: SpecialistTemplateRole, now: string): ManagerAgentRecord {
  const template = resolveSpecialistTemplate(role, 1);
  return {
    id: agentIdForRole(role),
    label: `Phase6b ${template.displayName}`,
    eligibleProjectIds: ["medimori", "twilight-feather"],
    capabilities: [...template.supportedCapabilities],
    status: "available",
    maxConcurrentAssignments: template.lifecycleRules.maxConcurrentAssignments,
    activeAssignmentIds: [],
    lastObservedAt: now,
  };
}

export function registerPhase6bAgents(store: MemoryOrchestrationQueueStore, now: string): void {
  const roles: SpecialistTemplateRole[] = [
    "research_planning",
    "engineering",
    "qa_independent_review",
    "devops",
  ];
  for (const role of roles) {
    store.registerAgentSync(buildPhase6bAgent(role, now));
  }
}

export function roleForAgentId(agentId: string): SpecialistTemplateRole | null {
  if (!agentId.startsWith(PHASE6B_AGENT_PREFIX)) return null;
  const role = agentId.slice(PHASE6B_AGENT_PREFIX.length) as SpecialistTemplateRole;
  return role;
}
