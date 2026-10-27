import type { ApprovalDatabaseIdentityConfig, ApprovalSessionObservation } from "./adapter/identity-guards";
import {
  assertApprovalExecutorSession as assertExecutorWithConfig,
  assertApprovalIssuancePermitted as assertIssuanceWithConfig,
  assertApprovalIssuerSession as assertIssuerWithConfig,
} from "./adapter/identity-guards";

/**
 * Connection preflight for a future approval adapter.
 * This module does not open a connection, read DATABASE_URL, or call getSql().
 * Issuance stays blocked until a same-session observation matches this contract.
 * The live approval route keeps unavailableApprovalStore.
 *
 * PostgreSQL must also run central_agent_manager.assert_session_identity()
 * on that same session before any approval write. current_user there is the
 * function owner; session_user, current_database(), and neon.branch_id are
 * the connection being checked.
 */
export const approvalDatabaseIdentity = {
  projectId: "aged-brook-70202332",
  branchId: "br-nameless-mode-b7hkls9l",
  databaseName: "neondb",
  host: "ep-bold-bird-b73ys3uy",
  authorityRole: "central_agent_manager_approval_authority",
  executorRole: "central_agent_manager_executor",
} satisfies ApprovalDatabaseIdentityConfig;

export type { ApprovalDatabaseIdentityConfig, ApprovalSessionObservation };

export function assertApprovalIssuerSession(observed: ApprovalSessionObservation): void {
  assertIssuerWithConfig(approvalDatabaseIdentity, observed);
}

export function assertApprovalExecutorSession(observed: ApprovalSessionObservation): void {
  assertExecutorWithConfig(approvalDatabaseIdentity, observed);
}

/** Future issuance code calls this before opening a write. It does not connect. */
export function assertApprovalIssuancePermitted(observed: ApprovalSessionObservation): void {
  assertIssuanceWithConfig(approvalDatabaseIdentity, observed);
}
