import { SupervisorContractError } from "../supervisor/types";
import type { SpecialistTemplateV1, SpecialistToolClass } from "./specialist-template-registry";

export const PROJECT_POLICY_CONTRACT_V1 = "cam-project-policy/v1" as const;

export type ProjectId = "medimori" | "twilight_feather";

export type ProjectPolicyOverlayV1 = {
  contractVersion: typeof PROJECT_POLICY_CONTRACT_V1;
  projectId: ProjectId;
  /** Additional prohibitions; cannot remove platform prohibitions. */
  deniedOperations: readonly string[];
  deniedToolClasses: readonly SpecialistToolClass[];
  maxConcurrentWorkers: number;
  maxObjectiveCostUsd: number;
};

const platformDeniedOperations = [
  "production_secrets",
  "destructive_database",
  "arbitrary_shell",
] as const;

const platformDeniedTools: readonly SpecialistToolClass[] = ["shell", "arbitrary_network"];

const medimoriPolicy: ProjectPolicyOverlayV1 = {
  contractVersion: PROJECT_POLICY_CONTRACT_V1,
  projectId: "medimori",
  deniedOperations: ["production_deploy"],
  deniedToolClasses: ["arbitrary_network"],
  maxConcurrentWorkers: 3,
  maxObjectiveCostUsd: 5,
};

const twilightPolicy: ProjectPolicyOverlayV1 = {
  contractVersion: PROJECT_POLICY_CONTRACT_V1,
  projectId: "twilight_feather",
  deniedOperations: ["production_infrastructure", "payments"],
  deniedToolClasses: ["deploy_readiness"],
  maxConcurrentWorkers: 2,
  maxObjectiveCostUsd: 2,
};

const projectPolicies: Record<ProjectId, ProjectPolicyOverlayV1> = {
  medimori: medimoriPolicy,
  twilight_feather: twilightPolicy,
};

export type EffectivePermissionContext = {
  projectId: ProjectId;
  template: SpecialistTemplateV1;
  taskOperations: readonly string[];
  ownerApprovedOperations?: readonly string[];
};

export type EffectivePermissionResult = {
  allowedOperations: string[];
  deniedReasons: string[];
};

export function getProjectPolicy(projectId: ProjectId): ProjectPolicyOverlayV1 {
  const policy = projectPolicies[projectId];
  if (!policy) throw new SupervisorContractError("Unknown project policy.");
  return policy;
}

export function resolveEffectivePermissions(input: EffectivePermissionContext): EffectivePermissionResult {
  const project = getProjectPolicy(input.projectId);
  const denied = new Set<string>([...platformDeniedOperations, ...project.deniedOperations]);
  const deniedTools = new Set<SpecialistToolClass>([...platformDeniedTools, ...project.deniedToolClasses]);
  const allowed: string[] = [];
  const deniedReasons: string[] = [];

  for (const operation of input.taskOperations) {
    if (denied.has(operation)) {
      deniedReasons.push(`operation_denied:${operation}`);
      continue;
    }
    if (!input.template.supportedCapabilities.includes(operation) &&
        !input.template.approvalGates.includes(operation)) {
      deniedReasons.push(`template_unsupported:${operation}`);
      continue;
    }
    if (input.template.approvalGates.includes(operation)) {
      if (!input.ownerApprovedOperations?.includes(operation)) {
        deniedReasons.push(`approval_required:${operation}`);
        continue;
      }
    }
    allowed.push(operation);
  }

  for (const tool of input.template.allowedToolClasses) {
    if (deniedTools.has(tool)) {
      deniedReasons.push(`tool_denied:${tool}`);
    }
  }

  return { allowedOperations: allowed, deniedReasons };
}

export function assertOverlayCannotExpand(input: {
  baseDenied: readonly string[];
  overlayAddOperations: readonly string[];
}): void {
  for (const op of input.overlayAddOperations) {
    if (input.baseDenied.includes(op)) {
      throw new SupervisorContractError("Project overlay cannot grant platform-denied operation.");
    }
  }
}
