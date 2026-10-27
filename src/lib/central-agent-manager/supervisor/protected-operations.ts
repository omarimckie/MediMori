import {
  limits,
  protectedOperations,
  type ProtectedOperation,
} from "../../engineering/policy";

/**
 * Protected operation identifiers come from the engineering policy module.
 * That module is pure: it does not import the worker or open a database.
 * The engineering worker remains the execution authority. This supervisor
 * only decides whether a future handoff would be eligible.
 *
 * Marketing publication, notification send, and live schedule changes are
 * distinct operation ids. Each one uses the shared `external_publish` gate,
 * and an approval for one id does not authorize another.
 */
export { limits, protectedOperations, type ProtectedOperation };

export const supervisorOperationIds = [
  "read_content",
  "read_analytics",
  "prepare_draft",
  "prepare_schedule_proposal",
  "prepare_plan",
  "run_allowlisted_validation",
  "read_research",
  "prepare_research_report",
  "read_health",
  "external_publish",
  "send_notification",
  "modify_live_schedule",
  "merge_main",
  "production_deploy",
  "production_secrets",
  "destructive_database",
  "auth_security",
  "payments",
  "production_infrastructure",
  "repository_write",
  "database_write",
  "production_change",
  "activate_worker",
  "modify_environment",
  "modify_credentials",
  "perform_repair",
] as const;

export type SupervisorOperation = (typeof supervisorOperationIds)[number];

const known = new Set<string>(supervisorOperationIds);

const protectionClasses: Partial<Record<SupervisorOperation, ProtectedOperation>> = {
  external_publish: "external_publish",
  send_notification: "external_publish",
  modify_live_schedule: "external_publish",
  merge_main: "merge_main",
  production_deploy: "production_deploy",
  production_secrets: "production_secrets",
  destructive_database: "destructive_database",
  auth_security: "auth_security",
  payments: "payments",
  production_infrastructure: "production_infrastructure",
};

export function isKnownOperation(value: string): value is SupervisorOperation {
  return known.has(value);
}

export function protectionClass(operation: string): ProtectedOperation | null {
  if (!isKnownOperation(operation)) return null;
  return protectionClasses[operation] ?? null;
}

export function requiresOwnerApproval(operation: string): boolean {
  return protectionClass(operation) !== null;
}
