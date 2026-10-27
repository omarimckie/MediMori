import { SupervisorContractError } from "../supervisor/types";

export type ApprovalDatabaseIdentityConfig = {
  projectId: string;
  branchId: string;
  databaseName: string;
  host: string;
  authorityRole: string;
  executorRole: string;
};

export type ApprovalSessionObservation = {
  projectId: string;
  branchId: string;
  databaseName: string;
  host: string;
  sessionUser: string;
  currentDatabase: string;
  neonBranchId: string;
};

const rejectedHosts = new Set(["ep-muddy-math-auxmesyz", "ep-gentle-dawn-au6vxirn"]);
const rejectedProjects = new Set(["solitary-leaf-77946642"]);
const rejectedBranches = new Set(["br-quiet-fire-ausvjkg8", "br-little-art-au7ke21s"]);
const rejectedRoles = new Set([
  "neondb_owner",
  "central_agent_manager_approval_owner",
  "central_agent_manager_approval",
]);

function reject(): never {
  throw new SupervisorContractError("Approval database identity was rejected.");
}

function required(value: string): string {
  if (typeof value !== "string" || value.trim() === "") reject();
  return value.trim();
}

export function endpointIdFromHost(host: string): string {
  const normalized = required(host).toLowerCase();
  const first = normalized.split(".")[0] ?? "";
  const remainder = normalized.slice(first.length);
  if (remainder !== "" && !remainder.endsWith(".neon.tech")) reject();
  if (!/^[a-z0-9-]+$/.test(first)) reject();
  return first.endsWith("-pooler") ? first.slice(0, -"-pooler".length) : first;
}

function assertObservedSession(
  identity: ApprovalDatabaseIdentityConfig,
  observed: ApprovalSessionObservation,
): void {
  const projectId = required(observed?.projectId);
  const branchId = required(observed?.branchId);
  const databaseName = required(observed?.databaseName);
  const sessionUser = required(observed?.sessionUser);
  const currentDatabase = required(observed?.currentDatabase);
  const neonBranchId = required(observed?.neonBranchId);
  const host = endpointIdFromHost(observed?.host);
  if (
    rejectedHosts.has(host) ||
    rejectedProjects.has(projectId) ||
    rejectedBranches.has(branchId) ||
    rejectedBranches.has(neonBranchId) ||
    rejectedRoles.has(sessionUser)
  ) {
    reject();
  }
  if (
    projectId !== identity.projectId ||
    branchId !== identity.branchId ||
    databaseName !== identity.databaseName ||
    currentDatabase !== identity.databaseName ||
    host !== identity.host
  ) {
    reject();
  }
  if (neonBranchId !== identity.branchId) {
    reject();
  }
}

export function assertApprovalIssuerSession(
  identity: ApprovalDatabaseIdentityConfig,
  observed: ApprovalSessionObservation,
): void {
  assertObservedSession(identity, observed);
  if (observed.sessionUser !== identity.authorityRole) reject();
}

export function assertApprovalExecutorSession(
  identity: ApprovalDatabaseIdentityConfig,
  observed: ApprovalSessionObservation,
): void {
  assertObservedSession(identity, observed);
  if (observed.sessionUser !== identity.executorRole) reject();
}

export function assertApprovalIssuancePermitted(
  identity: ApprovalDatabaseIdentityConfig,
  observed: ApprovalSessionObservation,
): void {
  assertApprovalIssuerSession(identity, observed);
}
