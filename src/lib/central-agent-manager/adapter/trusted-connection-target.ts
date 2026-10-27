import { SupervisorContractError } from "../supervisor/types";
import type { ApprovalDatabaseIdentityConfig } from "./identity-guards";
import { endpointIdFromHost } from "./identity-guards";

/** Independently configured connection target (from Neon API / operator config), not from the database session. */
export type TrustedConnectionTarget = {
  projectId: string;
  branchId: string;
  databaseName: string;
  host: string;
};

export function trustedTargetFromIdentity(identity: ApprovalDatabaseIdentityConfig): TrustedConnectionTarget {
  return {
    projectId: identity.projectId,
    branchId: identity.branchId,
    databaseName: identity.databaseName,
    host: identity.host,
  };
}

export function normalizeConnectionTarget(target: TrustedConnectionTarget): TrustedConnectionTarget {
  return {
    projectId: target.projectId.trim(),
    branchId: target.branchId.trim(),
    databaseName: target.databaseName.trim(),
    host: endpointIdFromHost(target.host),
  };
}

export function assertTrustedConnectionTarget(
  trusted: TrustedConnectionTarget,
  attempted: TrustedConnectionTarget,
): void {
  const expected = normalizeConnectionTarget(trusted);
  const actual = normalizeConnectionTarget(attempted);
  if (
    expected.projectId !== actual.projectId ||
    expected.branchId !== actual.branchId ||
    expected.databaseName !== actual.databaseName ||
    expected.host !== actual.host
  ) {
    throw new SupervisorContractError("Approval connection target was rejected.");
  }
}
