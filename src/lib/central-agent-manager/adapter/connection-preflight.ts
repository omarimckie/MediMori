import type { ApprovalDatabaseIdentityConfig, ApprovalSessionObservation } from "./identity-guards";
import {
  assertApprovalExecutorSession,
  assertApprovalIssuancePermitted,
  assertApprovalIssuerSession,
} from "./identity-guards";
import {
  assertTrustedConnectionTarget,
  normalizeConnectionTarget,
  type TrustedConnectionTarget,
} from "./trusted-connection-target";

export type ConnectionPreflightDeps = {
  identity: ApprovalDatabaseIdentityConfig;
  trustedTarget: TrustedConnectionTarget;
  /** Target derived from the connection descriptor about to be opened (never a live DB session). */
  attemptedTarget: TrustedConnectionTarget;
};

/**
 * Runs before any privileged pool connect. Does not trust session variables.
 */
export function verifyBeforeConnect(deps: ConnectionPreflightDeps): void {
  assertTrustedConnectionTarget(deps.trustedTarget, deps.attemptedTarget);
}

export type SessionPreflightDeps = ConnectionPreflightDeps & {
  observed: ApprovalSessionObservation;
};

/**
 * After connect: reconcile trusted target with observation. `neon.branch_id` must agree with trusted branch.
 */
export function verifyAuthoritySession(deps: SessionPreflightDeps): void {
  verifyBeforeConnect(deps);
  const normalized = normalizeConnectionTarget(deps.attemptedTarget);
  assertApprovalIssuerSession(deps.identity, {
    ...deps.observed,
    projectId: deps.identity.projectId,
    branchId: deps.identity.branchId,
    databaseName: deps.identity.databaseName,
    host: normalized.host,
  });
}

export function verifyExecutorSession(deps: SessionPreflightDeps): void {
  verifyBeforeConnect(deps);
  const normalized = normalizeConnectionTarget(deps.attemptedTarget);
  assertApprovalExecutorSession(deps.identity, {
    ...deps.observed,
    projectId: deps.identity.projectId,
    branchId: deps.identity.branchId,
    databaseName: deps.identity.databaseName,
    host: normalized.host,
  });
}

export function verifyIssuancePreflight(deps: SessionPreflightDeps): void {
  verifyBeforeConnect(deps);
  const normalized = normalizeConnectionTarget(deps.attemptedTarget);
  assertApprovalIssuancePermitted(deps.identity, {
    ...deps.observed,
    projectId: deps.identity.projectId,
    branchId: deps.identity.branchId,
    databaseName: deps.identity.databaseName,
    host: normalized.host,
  });
}
