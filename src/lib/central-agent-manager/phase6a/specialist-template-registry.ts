import { SupervisorContractError } from "../supervisor/types";

export const SPECIALIST_TEMPLATE_CONTRACT_V1 = "cam-specialist-template/v1" as const;

export const specialistTemplateRoles = [
  "engineering",
  "qa_independent_review",
  "devops",
  "research_planning",
] as const;

export type SpecialistTemplateRole = (typeof specialistTemplateRoles)[number];

export type SpecialistToolClass =
  | "plan"
  | "allowlisted_validation"
  | "independent_review"
  | "evidence_verify"
  | "deploy_readiness"
  | "infra_read"
  | "research_read"
  | "research_report"
  | "shell"
  | "arbitrary_network";

export type SpecialistTemplateV1 = {
  contractVersion: typeof SPECIALIST_TEMPLATE_CONTRACT_V1;
  templateVersion: 1;
  role: SpecialistTemplateRole;
  displayName: string;
  linkedSpecialistId: "engineering" | "operations" | "research" | "marketing";
  supportedCapabilities: readonly string[];
  allowedToolClasses: readonly SpecialistToolClass[];
  prohibitedToolClasses: readonly SpecialistToolClass[];
  requiredInputs: readonly string[];
  expectedOutputs: readonly string[];
  completionEvidenceKinds: readonly string[];
  runtimeRequirements: {
    isolation: "isolated_workspace" | "shared_process" | "read_only_credential";
    adapterId: string;
    fakeTransportOnly: boolean;
  };
  budgetCeiling: {
    modelCalls: number;
    costUsd: number;
    durationMs: number;
    maxRetries: number;
  };
  approvalGates: readonly string[];
  lifecycleRules: {
    maxConcurrentAssignments: number;
    staleAfterMs: number;
    requiresIndependentQaForCompletion: boolean;
  };
};

const engineeringTemplate: SpecialistTemplateV1 = {
  contractVersion: SPECIALIST_TEMPLATE_CONTRACT_V1,
  templateVersion: 1,
  role: "engineering",
  displayName: "Engineering Worker",
  linkedSpecialistId: "engineering",
  supportedCapabilities: ["prepare_plan", "run_allowlisted_validation"],
  allowedToolClasses: ["plan", "allowlisted_validation"],
  prohibitedToolClasses: ["independent_review", "evidence_verify", "shell", "arbitrary_network"],
  requiredInputs: ["objectiveId", "taskId", "workspaceRef"],
  expectedOutputs: ["implementation_evidence", "validation_report"],
  completionEvidenceKinds: ["work_completed", "validation_passed"],
  runtimeRequirements: {
    isolation: "isolated_workspace",
    adapterId: "engineering-worker",
    fakeTransportOnly: true,
  },
  budgetCeiling: { modelCalls: 8, costUsd: 2, durationMs: 30 * 60_000, maxRetries: 2 },
  approvalGates: ["production_deploy", "destructive_database"],
  lifecycleRules: {
    maxConcurrentAssignments: 1,
    staleAfterMs: 15 * 60_000,
    requiresIndependentQaForCompletion: true,
  },
};

const qaTemplate: SpecialistTemplateV1 = {
  contractVersion: SPECIALIST_TEMPLATE_CONTRACT_V1,
  templateVersion: 1,
  role: "qa_independent_review",
  displayName: "Independent QA / Review",
  linkedSpecialistId: "operations",
  supportedCapabilities: ["independent_review", "verify_evidence"],
  allowedToolClasses: ["independent_review", "evidence_verify", "allowlisted_validation"],
  prohibitedToolClasses: ["plan", "shell", "arbitrary_network"],
  requiredInputs: ["objectiveId", "taskId", "subjectEvidenceIds"],
  expectedOutputs: ["qa_verdict"],
  completionEvidenceKinds: ["qa_passed", "qa_failed"],
  runtimeRequirements: {
    isolation: "read_only_credential",
    adapterId: "qa-readonly",
    fakeTransportOnly: true,
  },
  budgetCeiling: { modelCalls: 4, costUsd: 0.5, durationMs: 10 * 60_000, maxRetries: 1 },
  approvalGates: [],
  lifecycleRules: {
    maxConcurrentAssignments: 2,
    staleAfterMs: 10 * 60_000,
    requiresIndependentQaForCompletion: false,
  },
};

const devopsTemplate: SpecialistTemplateV1 = {
  contractVersion: SPECIALIST_TEMPLATE_CONTRACT_V1,
  templateVersion: 1,
  role: "devops",
  displayName: "DevOps Worker",
  linkedSpecialistId: "operations",
  supportedCapabilities: ["read_health", "deploy_readiness_check"],
  allowedToolClasses: ["deploy_readiness", "infra_read"],
  prohibitedToolClasses: ["plan", "independent_review", "shell", "arbitrary_network"],
  requiredInputs: ["objectiveId", "taskId", "environment"],
  expectedOutputs: ["readiness_report"],
  completionEvidenceKinds: ["deploy_readiness_ok"],
  runtimeRequirements: {
    isolation: "read_only_credential",
    adapterId: "devops-readonly",
    fakeTransportOnly: true,
  },
  budgetCeiling: { modelCalls: 3, costUsd: 0.25, durationMs: 5 * 60_000, maxRetries: 1 },
  approvalGates: ["production_infrastructure", "production_deploy"],
  lifecycleRules: {
    maxConcurrentAssignments: 1,
    staleAfterMs: 10 * 60_000,
    requiresIndependentQaForCompletion: false,
  },
};

const researchTemplate: SpecialistTemplateV1 = {
  contractVersion: SPECIALIST_TEMPLATE_CONTRACT_V1,
  templateVersion: 1,
  role: "research_planning",
  displayName: "Research / Planning",
  linkedSpecialistId: "research",
  supportedCapabilities: ["read_research", "prepare_research_report", "prepare_plan"],
  allowedToolClasses: ["research_read", "research_report", "plan"],
  prohibitedToolClasses: ["shell", "arbitrary_network", "independent_review"],
  requiredInputs: ["objectiveId", "taskId", "sources"],
  expectedOutputs: ["research_report", "decomposition_proposal"],
  completionEvidenceKinds: ["research_completed", "plan_proposal"],
  runtimeRequirements: {
    isolation: "shared_process",
    adapterId: "research-readonly",
    fakeTransportOnly: true,
  },
  budgetCeiling: { modelCalls: 6, costUsd: 1, durationMs: 20 * 60_000, maxRetries: 2 },
  approvalGates: [],
  lifecycleRules: {
    maxConcurrentAssignments: 2,
    staleAfterMs: 20 * 60_000,
    requiresIndependentQaForCompletion: false,
  },
};

const registryV1: Record<SpecialistTemplateRole, SpecialistTemplateV1> = {
  engineering: engineeringTemplate,
  qa_independent_review: qaTemplate,
  devops: devopsTemplate,
  research_planning: researchTemplate,
};

export type TemplateOverlayInput = {
  addCapabilities?: readonly string[];
  addToolClasses?: readonly SpecialistToolClass[];
};

export function resolveSpecialistTemplate(
  role: SpecialistTemplateRole,
  templateVersion: number,
  overlay?: TemplateOverlayInput,
): SpecialistTemplateV1 {
  if (templateVersion !== 1) {
    throw new SupervisorContractError("Unknown specialist template version.");
  }
  const base = registryV1[role];
  if (!base) {
    throw new SupervisorContractError("Unknown specialist template role.");
  }
  if (!overlay) return base;
  if (overlay.addCapabilities?.some((cap) => cap.includes("production") || cap.includes("shell"))) {
    throw new SupervisorContractError("Template overlay cannot expand privileged capabilities.");
  }
  if (overlay.addToolClasses?.some((tool) => base.prohibitedToolClasses.includes(tool))) {
    throw new SupervisorContractError("Template overlay cannot enable prohibited tool classes.");
  }
  const mergedTools = new Set([...base.allowedToolClasses, ...(overlay.addToolClasses ?? [])]);
  for (const prohibited of base.prohibitedToolClasses) {
    if (mergedTools.has(prohibited)) {
      throw new SupervisorContractError("Template overlay cannot enable prohibited tool classes.");
    }
  }
  return {
    ...base,
    supportedCapabilities: [...new Set([...base.supportedCapabilities, ...(overlay.addCapabilities ?? [])])],
    allowedToolClasses: [...mergedTools],
  };
}

export function listSpecialistTemplateRoles(): SpecialistTemplateRole[] {
  return [...specialistTemplateRoles];
}
