const stages = new Set([
  "implementation", "review", "worker", "configuration", "scratch_preflight",
  "database_identity", "source_export", "initialization", "post_apply_verification",
  "validation_environment_prepare", "validation_cycle", "validation_gate",
  "validation_progress", "validation_evidence", "docker_preflight", "image_check",
  "dependency_check", "source_volume", "next_env_overlay",
]);
const validationStages = new Set([
  "post_apply_verification", "validation_environment_prepare", "validation_cycle",
  "validation_gate", "validation_progress", "validation_evidence", "docker_preflight",
  "image_check", "dependency_check", "source_volume", "next_env_overlay",
]);
const codes = new Set([
  "provider_incomplete", "proposal_invalid_json", "proposal_invalid_shape", "proposal_out_of_scope",
  "proposal_invalid_content", "proposal_apply_failed", "proposal_evidence_persist_failed",
  "call_progress_persist_failed", "replacement_target_missing", "replacement_target_ambiguous",
  "replacement_overlap", "replacement_scope_rejected", "replacement_revision_mismatch",
  "replacement_content_invalid", "replacement_apply_failed", "validation_executor_unavailable",
  "validation_protocol_error", "validation_source_prepare_failed", "validation_overlay_prepare_failed",
  "validation_dependency_unavailable", "validation_image_unavailable", "validation_start_persistence_failed",
  "validation_evidence_persistence_failed", "post_apply_revision_mismatch",
  "post_apply_scope_verification_failed", "lease_or_fence_lost", "runtime_deadline_exceeded",
  "sandbox_cleanup_failed", "worker_failure", "worker_disabled", "required_configuration_missing",
  "invalid_run_id", "worker_database_config_missing", "worker_database_config_invalid",
  "worker_database_connection_failed", "worker_database_identity_query_failed",
  "worker_database_identity_mismatch", "worker_database_branch_mismatch", "worker_database_role_mismatch",
  "worker_database_schema_mismatch", "invalid_sandbox_image", "invalid_dependency_volume",
  "invalid_model_policy", "invalid_rate_policy", "invalid_scratch_configuration", "scratch_path_missing",
  "scratch_path_inaccessible", "scratch_file_size_limit", "insufficient_scratch_capacity",
  "scratch_preflight_failed", "source_export_failed", "unexpected_setup_failure",
]);

/** Returns only bounded allowlisted classifications from persisted block diagnostics. */
export function safeBlockDiagnostic(action: unknown, diagnostic: unknown) {
  if (action !== "block" || !diagnostic || typeof diagnostic !== "object" || Array.isArray(diagnostic)) return undefined;
  const value = diagnostic as Record<string, unknown>;
  const safe: Record<string, string> = {};
  const operation = value.operation;
  if (action === "block" && typeof operation === "string" && ["provider_call", "apply_proposal", "prepare_validation_environment", "run_validation", "workspace_cleanup", "worker_lifecycle"].includes(operation)) safe.operation = operation;
  const category = value.category;
  if (action === "block" && typeof category === "string" && ["provider_failure", "proposal_failure", "validation_failure", "cleanup_failure", "worker_failure"].includes(category)) safe.category = category;
  const cleanupOutcome = value.cleanupOutcome;
  if (action === "block" && typeof cleanupOutcome === "string" && ["succeeded", "failed", "not_attempted"].includes(cleanupOutcome)) safe.cleanupOutcome = cleanupOutcome;
  if (typeof value.code === "string" && value.code.length <= 80 && codes.has(value.code)) safe.code = value.code;
  if (typeof value.stage === "string" && value.stage.length <= 80 && stages.has(value.stage)) safe.stage = value.stage;
  if (typeof value.validationStage === "string" && value.validationStage.length <= 80 && validationStages.has(value.validationStage)) safe.validationStage = value.validationStage;
  return Object.keys(safe).length ? safe : undefined;
}

/** The bounded diagnostic field included in authenticated admin event history. */
export function safeAdminEventDiagnostic(action: unknown, details: unknown) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  const diagnostic = safeBlockDiagnostic(action, (details as Record<string, unknown>).diagnostic);
  return diagnostic ? { diagnostic } : {};
}
