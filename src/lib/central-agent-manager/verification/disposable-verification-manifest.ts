export type VerificationRole = "M" | "A" | "E" | "LOCAL";

export type DisposableVerificationCase = {
  id: string;
  phase: number;
  role: VerificationRole;
  prerequisite: string;
  sqlOperations: string[];
  expectedOutcome: "success" | "error";
  expectedErrorCode?: string;
  evidence: string[];
  stopOnFail: boolean;
  teardown: "none" | "delete_rows" | "delete_branch";
};

export const MANDATORY_DISPOSABLE_VERIFICATION_IDS = [
  "1.1", "1.2", "1.3", "1.4",
  "2.1", "2.2", "2.3", "2.4",
  "3.1", "3.2", "3.3", "3.4", "3.5",
  "4.1", "4.2", "4.3", "4.4", "4.5",
  "5.1", "5.2", "5.3", "5.4", "5.5",
  "6.1", "6.2", "6.3", "6.4",
  "7.1", "7.2", "7.3", "7.5a", "7.5b", "7.5c",
  "8.1", "8.2",
  "9.1", "9.3", "9.4",
] as const;

export const disposableVerificationManifest: DisposableVerificationCase[] = [
  { id: "1.1", phase: 2, role: "A", prerequisite: "OL on V1", sqlOperations: ["central_agent_manager.canonical_task_json", "central_agent_manager.sha256_hex"], expectedOutcome: "success", evidence: ["digest_hex"], stopOnFail: true, teardown: "none" },
  { id: "1.2", phase: 2, role: "A", prerequisite: "OL on V1", sqlOperations: ["central_agent_manager.canonical_approval_json", "central_agent_manager.sha256_hex"], expectedOutcome: "success", evidence: ["digest_hex"], stopOnFail: true, teardown: "none" },
  { id: "1.3", phase: 2, role: "A", prerequisite: "save_task completed", sqlOperations: ["central_agent_manager.save_task"], expectedOutcome: "success", evidence: ["tasks.plan_digest"], stopOnFail: true, teardown: "delete_rows" },
  { id: "1.4", phase: 2, role: "A", prerequisite: "task saved", sqlOperations: ["central_agent_manager.issue_owner_approval"], expectedOutcome: "error", expectedErrorCode: "operation_not_in_plan", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "delete_rows" },
  { id: "2.1", phase: 2, role: "A", prerequisite: "live approval", sqlOperations: ["central_agent_manager.save_task"], expectedOutcome: "error", expectedErrorCode: "authorization_content_is_frozen", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "delete_rows" },
  { id: "2.2", phase: 2, role: "A", prerequisite: "live approval", sqlOperations: ["UPDATE central_agent_manager.tasks"], expectedOutcome: "error", expectedErrorCode: "authorization_content_is_frozen", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "delete_rows" },
  { id: "2.3", phase: 2, role: "A", prerequisite: "live approval", sqlOperations: ["UPDATE central_agent_manager.approvals"], expectedOutcome: "error", expectedErrorCode: "approval_binding_is_immutable", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "delete_rows" },
  { id: "2.4", phase: 2, role: "A", prerequisite: "revoked approval", sqlOperations: ["central_agent_manager.revoke_owner_approval"], expectedOutcome: "error", expectedErrorCode: "revocation_is_permanent", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "delete_rows" },
  { id: "3.1", phase: 3, role: "E", prerequisite: "approved + live approval", sqlOperations: ["central_agent_manager.mark_task_running"], expectedOutcome: "success", evidence: ["tasks.state"], stopOnFail: true, teardown: "delete_rows" },
  { id: "3.2", phase: 3, role: "A", prerequisite: "running task", sqlOperations: ["central_agent_manager.revoke_owner_approval"], expectedOutcome: "success", evidence: ["approvals.revoked_at"], stopOnFail: true, teardown: "delete_rows" },
  { id: "3.3", phase: 3, role: "E", prerequisite: "revoked approval", sqlOperations: ["central_agent_manager.mark_task_running"], expectedOutcome: "error", expectedErrorCode: "approval_not_live", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "delete_rows" },
  { id: "3.4", phase: 3, role: "E", prerequisite: "expired approval", sqlOperations: ["central_agent_manager.mark_task_running", "central_agent_manager.issue_owner_approval"], expectedOutcome: "error", expectedErrorCode: "approval_replay_expired", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "delete_rows" },
  { id: "3.5", phase: 3, role: "E", prerequisite: "live approval", sqlOperations: ["central_agent_manager.mark_task_running"], expectedOutcome: "error", expectedErrorCode: "approval_not_live", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "delete_rows" },
  { id: "4.1", phase: 3, role: "E", prerequisite: "executor session", sqlOperations: ["central_agent_manager.issue_owner_approval"], expectedOutcome: "error", expectedErrorCode: "approval_authority_required", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "none" },
  { id: "4.2", phase: 3, role: "E", prerequisite: "executor session", sqlOperations: ["central_agent_manager.save_task"], expectedOutcome: "error", evidence: ["privilege_denied"], stopOnFail: true, teardown: "none" },
  { id: "4.3", phase: 3, role: "A", prerequisite: "authority session", sqlOperations: ["central_agent_manager.mark_task_running"], expectedOutcome: "error", expectedErrorCode: "approval_executor_required", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "none" },
  { id: "4.4", phase: 3, role: "M", prerequisite: "post-apply", sqlOperations: ["has_function_privilege"], expectedOutcome: "success", evidence: ["privilege_catalog"], stopOnFail: true, teardown: "none" },
  { id: "4.5", phase: 3, role: "A", prerequisite: "authority session", sqlOperations: ["INSERT central_agent_manager.approvals"], expectedOutcome: "error", evidence: ["privilege_denied"], stopOnFail: true, teardown: "none" },
  { id: "5.1", phase: 4, role: "M", prerequisite: "post-apply", sqlOperations: ["pg_class.relrowsecurity"], expectedOutcome: "success", evidence: ["rls_catalog"], stopOnFail: true, teardown: "none" },
  { id: "5.2", phase: 4, role: "M", prerequisite: "post-apply", sqlOperations: ["has_function_privilege public"], expectedOutcome: "success", evidence: ["privilege_catalog"], stopOnFail: true, teardown: "none" },
  { id: "5.3", phase: 4, role: "M", prerequisite: "post-apply", sqlOperations: ["has_table_privilege executor"], expectedOutcome: "success", evidence: ["privilege_catalog"], stopOnFail: true, teardown: "none" },
  { id: "5.4", phase: 4, role: "M", prerequisite: "post-apply", sqlOperations: ["aclexplode audit"], expectedOutcome: "success", evidence: ["privilege_catalog"], stopOnFail: true, teardown: "none" },
  { id: "5.5", phase: 4, role: "M", prerequisite: "post-apply", sqlOperations: ["pg_proc.prosecdef"], expectedOutcome: "success", evidence: ["definer_catalog"], stopOnFail: true, teardown: "none" },
  { id: "6.1", phase: 4, role: "A", prerequisite: "live approval", sqlOperations: ["central_agent_manager.issue_owner_approval"], expectedOutcome: "success", evidence: ["idempotent_row"], stopOnFail: true, teardown: "delete_rows" },
  { id: "6.2", phase: 4, role: "A", prerequisite: "revoked approval", sqlOperations: ["central_agent_manager.issue_owner_approval"], expectedOutcome: "error", expectedErrorCode: "approval_replay_revoked", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "delete_rows" },
  { id: "6.3", phase: 4, role: "A", prerequisite: "expired approval", sqlOperations: ["central_agent_manager.issue_owner_approval"], expectedOutcome: "error", expectedErrorCode: "approval_replay_expired", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "delete_rows" },
  { id: "6.4", phase: 4, role: "A", prerequisite: "concurrent issuers", sqlOperations: ["central_agent_manager.issue_owner_approval"], expectedOutcome: "error", expectedErrorCode: "conflicting_live_approval", evidence: ["one_live_row"], stopOnFail: true, teardown: "delete_rows" },
  { id: "7.1", phase: 5, role: "A", prerequisite: "V1 endpoint", sqlOperations: ["central_agent_manager.assert_session_identity"], expectedOutcome: "success", evidence: ["no_exception"], stopOnFail: true, teardown: "none" },
  { id: "7.2", phase: 5, role: "A", prerequisite: "V1 endpoint", sqlOperations: ["SET neon.branch_id", "central_agent_manager.issue_owner_approval"], expectedOutcome: "error", expectedErrorCode: "approval_database_identity_rejected", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "none" },
  { id: "7.3", phase: 5, role: "A", prerequisite: "wrong database URL", sqlOperations: ["central_agent_manager.assert_session_identity"], expectedOutcome: "error", expectedErrorCode: "approval_database_identity_rejected", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "none" },
  { id: "7.5a", phase: 5, role: "A", prerequisite: "aligned target", sqlOperations: ["central_agent_manager.issue_owner_approval"], expectedOutcome: "success", evidence: ["approval_row"], stopOnFail: true, teardown: "delete_rows" },
  { id: "7.5b", phase: 5, role: "A", prerequisite: "V1 endpoint spoof GUC", sqlOperations: ["SET neon.branch_id", "central_agent_manager.save_task"], expectedOutcome: "error", expectedErrorCode: "approval_database_identity_rejected", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "none" },
  { id: "7.5c", phase: 5, role: "A", prerequisite: "V2 endpoint V1 overlay", sqlOperations: ["central_agent_manager.issue_owner_approval"], expectedOutcome: "error", evidence: ["exception_sqlstate"], stopOnFail: true, teardown: "none" },
  { id: "8.1", phase: 5, role: "A", prerequisite: "two sessions", sqlOperations: ["central_agent_manager.issue_owner_approval"], expectedOutcome: "success", evidence: ["one_live_row"], stopOnFail: true, teardown: "delete_rows" },
  { id: "8.2", phase: 5, role: "A", prerequisite: "two sessions same key", sqlOperations: ["central_agent_manager.issue_owner_approval"], expectedOutcome: "success", evidence: ["one_row"], stopOnFail: true, teardown: "delete_rows" },
  { id: "9.1", phase: 1, role: "M", prerequisite: "fresh V1", sqlOperations: ["Part A", "Part B overlay"], expectedOutcome: "success", evidence: ["commit_ok", "audit_do_ok"], stopOnFail: true, teardown: "none" },
  { id: "9.3", phase: 6, role: "M", prerequisite: "verification complete", sqlOperations: ["DROP SCHEMA", "delete_branch"], expectedOutcome: "success", evidence: ["branch_absent"], stopOnFail: true, teardown: "delete_branch" },
  { id: "9.4", phase: 6, role: "M", prerequisite: "pre-teardown", sqlOperations: ["catalog_export"], expectedOutcome: "success", evidence: ["redacted_bundle"], stopOnFail: false, teardown: "none" },
];

export type ManifestDryRunReport = {
  ok: boolean;
  caseCount: number;
  duplicateIds: string[];
  missingIds: string[];
  extraIds: string[];
};

export function dryRunValidateDisposableManifest(): ManifestDryRunReport {
  const ids = disposableVerificationManifest.map((case_) => case_.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  const set = new Set(ids);
  const missingIds = MANDATORY_DISPOSABLE_VERIFICATION_IDS.filter((id) => !set.has(id));
  const mandatory = new Set(MANDATORY_DISPOSABLE_VERIFICATION_IDS);
  const extraIds = ids.filter((id) => !mandatory.has(id as (typeof MANDATORY_DISPOSABLE_VERIFICATION_IDS)[number]));
  const ok =
    duplicateIds.length === 0 &&
    missingIds.length === 0 &&
    extraIds.length === 0 &&
    disposableVerificationManifest.length === MANDATORY_DISPOSABLE_VERIFICATION_IDS.length;
  return {
    ok,
    caseCount: disposableVerificationManifest.length,
    duplicateIds,
    missingIds,
    extraIds,
  };
}

export const VERIFICATION_REDACTION_RULES = [
  "Never log connection strings or passwords.",
  "Evidence stores exception names and SQLSTATE only.",
  "Digest evidence stores hex hashes only.",
  "Catalog exports omit role passwords.",
] as const;
