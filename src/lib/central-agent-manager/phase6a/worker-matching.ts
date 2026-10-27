import type { ProjectId } from "./project-policy";
import { resolveEffectivePermissions } from "./project-policy";
import {
  resolveSpecialistTemplate,
  type SpecialistTemplateRole,
  type SpecialistTemplateV1,
} from "./specialist-template-registry";

export type WorkerBackendAvailability = {
  role: SpecialistTemplateRole;
  adapterEnabled: boolean;
  concurrentSlots: number;
};

export type WorkerMatchRequest = {
  projectId: ProjectId;
  requiredCapabilities: readonly string[];
  taskOperations: readonly string[];
  ownerApprovedOperations?: readonly string[];
  backends: readonly WorkerBackendAvailability[];
  budgetRemainingUsd: number;
  /** Task ids implemented by same worker — QA cannot review its own implementation. */
  implementerTaskIds?: readonly string[];
  candidateTaskId: string;
};

export type WorkerMatchResult =
  | { ok: true; template: SpecialistTemplateV1; role: SpecialistTemplateRole; reason: string }
  | { ok: false; code: string; reason: string };

export function matchWorkerForTask(request: WorkerMatchRequest): WorkerMatchResult {
  const roles = request.backends.filter((b) => b.adapterEnabled && b.concurrentSlots > 0);
  if (roles.length === 0) {
    return { ok: false, code: "no_backend", reason: "No execution backend is available." };
  }
  if (request.budgetRemainingUsd <= 0) {
    return { ok: false, code: "budget_exhausted", reason: "Objective budget is exhausted." };
  }

  const candidates: WorkerMatchResult[] = [];
  for (const backend of roles) {
    const template = resolveSpecialistTemplate(backend.role, 1);
    if (request.requiredCapabilities.some((cap) => !template.supportedCapabilities.includes(cap))) {
      continue;
    }
    if (
      template.role === "qa_independent_review" &&
      request.implementerTaskIds?.includes(request.candidateTaskId)
    ) {
      continue;
    }
    const permissions = resolveEffectivePermissions({
      projectId: request.projectId,
      template,
      taskOperations: request.taskOperations,
      ownerApprovedOperations: request.ownerApprovedOperations,
    });
    if (permissions.deniedReasons.length > 0 && permissions.allowedOperations.length === 0) {
      continue;
    }
    candidates.push({
      ok: true,
      template,
      role: backend.role,
      reason: `matched:${backend.role}`,
    });
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      code: "no_authorized_worker",
      reason: "No authorized worker satisfies capability, policy, and approval constraints.",
    };
  }
  candidates.sort((a, b) => {
    if (!a.ok || !b.ok) return 0;
    const privilegeScore = (t: SpecialistTemplateV1) => t.allowedToolClasses.length;
    return privilegeScore(a.template) - privilegeScore(b.template);
  });
  const best = candidates[0];
  return best.ok ? best : { ok: false, code: "match_failed", reason: "Worker matching failed." };
}
