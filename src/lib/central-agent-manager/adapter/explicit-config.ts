import { validateAdapterConfig, type AdapterConfigDiagnostic } from "./config-validation";
import type { ApprovalDatabaseIdentityConfig } from "./identity-guards";

/**
 * Adapter identity from explicit operator env vars only.
 * Never reads DATABASE_URL or Vercel production configuration.
 */
export function resolveExplicitAdapterIdentity(): ApprovalDatabaseIdentityConfig | null {
  const projectId = process.env.CAM_APPROVAL_PROJECT_ID?.trim();
  const branchId = process.env.CAM_APPROVAL_BRANCH_ID?.trim();
  const databaseName = process.env.CAM_APPROVAL_DATABASE_NAME?.trim();
  const host = process.env.CAM_APPROVAL_ENDPOINT_ID?.trim();
  const authorityRole =
    process.env.CAM_APPROVAL_AUTHORITY_ROLE?.trim() || "central_agent_manager_approval_authority";
  const executorRole =
    process.env.CAM_APPROVAL_EXECUTOR_ROLE?.trim() || "central_agent_manager_executor";
  if (!projectId || !branchId || !databaseName || !host) return null;
  const config = {
    projectId,
    branchId,
    databaseName,
    host,
    authorityRole,
    executorRole,
  };
  if (!validateAdapterConfig(config).ok) return null;
  return config;
}

export function diagnoseExplicitAdapterConfig(): AdapterConfigDiagnostic {
  const projectId = process.env.CAM_APPROVAL_PROJECT_ID?.trim();
  const branchId = process.env.CAM_APPROVAL_BRANCH_ID?.trim();
  const databaseName = process.env.CAM_APPROVAL_DATABASE_NAME?.trim();
  const host = process.env.CAM_APPROVAL_ENDPOINT_ID?.trim();
  if (!projectId || !branchId || !databaseName || !host) {
    return { ok: false, code: "incomplete", message: "Approval adapter environment is incomplete." };
  }
  return validateAdapterConfig({
    projectId,
    branchId,
    databaseName,
    host,
    authorityRole:
      process.env.CAM_APPROVAL_AUTHORITY_ROLE?.trim() || "central_agent_manager_approval_authority",
    executorRole:
      process.env.CAM_APPROVAL_EXECUTOR_ROLE?.trim() || "central_agent_manager_executor",
  });
}
