import {
  engineeringBudget,
  specialistIds,
  SupervisorContractError,
  type SpecialistId,
  type SpecialistProfile,
} from "./types";

const hour = 60 * 60 * 1000;

const marketing: SpecialistProfile = {
  id: "marketing",
  displayName: "Marketing",
  responsibility: "Read content and analytics, and prepare drafts or schedule proposals.",
  permittedToolCategories: ["content_read", "analytics_read", "draft", "schedule_proposal"],
  requestableOperations: [
    "read_content",
    "read_analytics",
    "prepare_draft",
    "prepare_schedule_proposal",
    "external_publish",
    "send_notification",
    "modify_live_schedule",
  ],
  absoluteProhibitions: [],
  isolation: "shared_process",
  defaultBudget: {
    modelCalls: 4,
    tokens: 8_000,
    costUsd: 1,
    durationMs: 10 * 60 * 1000,
    repairs: 0,
    fileChanges: 0,
    concurrentSessions: 1,
  },
  supportedTaskTypes: ["content_read", "analytics_read", "draft", "schedule_proposal"],
  adapterId: "marketing-service",
  completionRequiresValidation: false,
};

const engineering: SpecialistProfile = {
  id: "engineering",
  displayName: "Engineering",
  responsibility: "Prepare isolated workspace plans and allowlisted validations.",
  permittedToolCategories: ["plan", "allowlisted_validation"],
  requestableOperations: [
    "prepare_plan",
    "run_allowlisted_validation",
    "merge_main",
    "production_deploy",
    "production_secrets",
    "destructive_database",
    "auth_security",
    "payments",
    "production_infrastructure",
  ],
  absoluteProhibitions: [],
  isolation: "isolated_workspace",
  defaultBudget: engineeringBudget,
  supportedTaskTypes: ["plan", "validation"],
  adapterId: "engineering-worker",
  completionRequiresValidation: true,
};

const research: SpecialistProfile = {
  id: "research",
  displayName: "Research",
  responsibility: "Read sources and prepare evidence-backed reports.",
  permittedToolCategories: ["research_read", "research_report"],
  requestableOperations: ["read_research", "prepare_research_report"],
  absoluteProhibitions: ["repository_write", "database_write", "production_change"],
  isolation: "shared_process",
  defaultBudget: {
    modelCalls: 4,
    tokens: 8_000,
    costUsd: 1,
    durationMs: hour,
    repairs: 0,
    fileChanges: 0,
    concurrentSessions: 1,
  },
  supportedTaskTypes: ["research_read", "research_report"],
  adapterId: "research-readonly",
  completionRequiresValidation: true,
};

const operations: SpecialistProfile = {
  id: "operations",
  displayName: "Operations",
  responsibility: "Aggregate read-only health and status.",
  permittedToolCategories: ["health_read"],
  requestableOperations: ["read_health"],
  absoluteProhibitions: [
    "activate_worker",
    "modify_environment",
    "modify_credentials",
    "perform_repair",
  ],
  isolation: "read_only_credential",
  defaultBudget: {
    modelCalls: 2,
    tokens: 2_000,
    costUsd: 0.25,
    durationMs: 60 * 1000,
    repairs: 0,
    fileChanges: 0,
    concurrentSessions: 1,
  },
  supportedTaskTypes: ["health_read"],
  adapterId: "operations-status",
  completionRequiresValidation: false,
};

export const specialistRegistry: Readonly<Record<SpecialistId, SpecialistProfile>> = Object.freeze({
  marketing,
  engineering,
  research,
  operations,
});

export function isSpecialistId(value: string): value is SpecialistId {
  return (specialistIds as readonly string[]).includes(value);
}

export function getSpecialistProfile(id: string): SpecialistProfile {
  if (!isSpecialistId(id)) {
    throw new SupervisorContractError("Unknown specialist.");
  }
  return specialistRegistry[id];
}
