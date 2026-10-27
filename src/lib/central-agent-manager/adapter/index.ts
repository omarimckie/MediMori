export type { ApprovalDatabaseIdentityConfig, ApprovalSessionObservation } from "./identity-guards";
export {
  assertApprovalExecutorSession,
  assertApprovalIssuancePermitted,
  assertApprovalIssuerSession,
  endpointIdFromHost,
} from "./identity-guards";
export type {
  ApprovalAuthorityPersistencePort,
  ApprovalConnectionLifecycle,
  ApprovalExecutorPersistencePort,
} from "./approval-persistence-port";
export {
  verifyAuthoritySession,
  verifyBeforeConnect,
  verifyExecutorSession,
  verifyIssuancePreflight,
} from "./connection-preflight";
export {
  createPostgresApprovalStore,
  createPostgresApprovalStoreFromIdentity,
  type PostgresApprovalStoreDeps,
} from "./postgres-approval-store";
export { toSafeApprovalAdapterMessage, wrapApprovalAdapterError } from "./safe-error";
export {
  assertTrustedConnectionTarget,
  normalizeConnectionTarget,
  trustedTargetFromIdentity,
  type TrustedConnectionTarget,
} from "./trusted-connection-target";
export {
  diagnoseExplicitAdapterConfig,
  resolveExplicitAdapterIdentity,
} from "./explicit-config";
export {
  assertValidAdapterConfig,
  validateAdapterConfig,
  type AdapterConfigDiagnostic,
} from "./config-validation";
