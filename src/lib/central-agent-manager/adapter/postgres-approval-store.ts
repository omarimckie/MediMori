import { SupervisorContractError } from "../supervisor/types";
import type {
  ApprovalCommitAttempt,
  TaskRunningAttempt,
  TrustedApprovalStore,
} from "../supervisor/trusted-approval";
import type { SupervisorTask } from "../supervisor/types";
import { assertValidAdapterConfig } from "./config-validation";
import type {
  ApprovalAuthorityPersistencePort,
  ApprovalConnectionLifecycle,
  ApprovalExecutorPersistencePort,
} from "./approval-persistence-port";
import {
  verifyAuthoritySession,
  verifyBeforeConnect,
  verifyExecutorSession,
} from "./connection-preflight";
import type { ApprovalDatabaseIdentityConfig } from "./identity-guards";
import { wrapApprovalAdapterError } from "./safe-error";
import { type TrustedConnectionTarget, trustedTargetFromIdentity } from "./trusted-connection-target";

export type SessionVerificationMode = "cached_gate" | "per_operation";

export type PostgresApprovalStoreDeps = {
  identity: ApprovalDatabaseIdentityConfig;
  trustedTarget: TrustedConnectionTarget;
  attemptedAuthorityTarget: TrustedConnectionTarget;
  attemptedExecutorTarget: TrustedConnectionTarget;
  lifecycle: ApprovalConnectionLifecycle;
  authority: ApprovalAuthorityPersistencePort;
  executor: ApprovalExecutorPersistencePort;
  /** Re-verify session identity on every privileged operation when using pooled connections. */
  sessionVerificationMode?: SessionVerificationMode;
};

type SessionGate = {
  authorityReady: boolean;
  executorReady: boolean;
};

function isIdentityOrTargetFailure(error: unknown): boolean {
  if (!(error instanceof SupervisorContractError)) return false;
  return /rejected|identity|target|authority|executor/i.test(error.message);
}

export function createPostgresApprovalStore(deps: PostgresApprovalStoreDeps): TrustedApprovalStore {
  assertValidAdapterConfig(deps.identity);
  const trustedTarget = deps.trustedTarget;
  const gate: SessionGate = { authorityReady: false, executorReady: false };

  function invalidateAuthority(): void {
    gate.authorityReady = false;
  }

  function invalidateExecutor(): void {
    gate.executorReady = false;
  }

  const sessionVerificationMode = deps.sessionVerificationMode ?? "cached_gate";

  async function ensureAuthoritySession(): Promise<void> {
    if (gate.authorityReady && sessionVerificationMode === "cached_gate") return;
    try {
      verifyBeforeConnect({
        identity: deps.identity,
        trustedTarget,
        attemptedTarget: deps.attemptedAuthorityTarget,
      });
      deps.lifecycle.beforeAuthorityConnect();
      const observed = await deps.lifecycle.observeAuthoritySession();
      verifyAuthoritySession({
        identity: deps.identity,
        trustedTarget,
        attemptedTarget: deps.attemptedAuthorityTarget,
        observed,
      });
      gate.authorityReady = true;
    } catch (error) {
      invalidateAuthority();
      deps.lifecycle.afterAuthorityConnectFailed?.();
      throw error;
    }
  }

  async function ensureExecutorSession(): Promise<void> {
    if (gate.executorReady && sessionVerificationMode === "cached_gate") return;
    try {
      verifyBeforeConnect({
        identity: deps.identity,
        trustedTarget,
        attemptedTarget: deps.attemptedExecutorTarget,
      });
      deps.lifecycle.beforeExecutorConnect();
      const observed = await deps.lifecycle.observeExecutorSession();
      verifyExecutorSession({
        identity: deps.identity,
        trustedTarget,
        attemptedTarget: deps.attemptedExecutorTarget,
        observed,
      });
      gate.executorReady = true;
    } catch (error) {
      invalidateExecutor();
      deps.lifecycle.afterExecutorConnectFailed?.();
      throw error;
    }
  }

  async function runAuthority<T>(work: () => Promise<T>): Promise<T> {
    try {
      await ensureAuthoritySession();
      return await work();
    } catch (error) {
      if (isIdentityOrTargetFailure(error)) invalidateAuthority();
      if (error instanceof SupervisorContractError) throw error;
      throw new SupervisorContractError(wrapApprovalAdapterError(error).message);
    }
  }

  async function runExecutor<T>(work: () => Promise<T>): Promise<T> {
    try {
      await ensureExecutorSession();
      return await work();
    } catch (error) {
      if (isIdentityOrTargetFailure(error)) invalidateExecutor();
      if (error instanceof SupervisorContractError) throw error;
      throw new SupervisorContractError(wrapApprovalAdapterError(error).message);
    }
  }

  return {
    readTask(taskId: string) {
      return runAuthority(() => deps.authority.readTask(taskId));
    },
    saveTask(task: SupervisorTask) {
      return runAuthority(() => deps.authority.saveTask(task));
    },
    commitApproval(attempt: ApprovalCommitAttempt) {
      return runAuthority(() => deps.authority.commitApproval(attempt));
    },
    readApproval(id: string) {
      return runAuthority(() => deps.authority.readApproval(id));
    },
    revokeApproval(id: string, now: string) {
      return runAuthority(() => deps.authority.revokeApproval(id, now));
    },
    markTaskRunning(attempt: TaskRunningAttempt) {
      return runExecutor(() => deps.executor.markTaskRunning(attempt));
    },
  };
}

export function createPostgresApprovalStoreFromIdentity(
  identity: ApprovalDatabaseIdentityConfig,
  partial: Omit<
    PostgresApprovalStoreDeps,
    "identity" | "trustedTarget" | "attemptedAuthorityTarget" | "attemptedExecutorTarget"
  > & {
    attemptedAuthorityTarget?: TrustedConnectionTarget;
    attemptedExecutorTarget?: TrustedConnectionTarget;
  },
): TrustedApprovalStore {
  const trustedTarget = trustedTargetFromIdentity(identity);
  return createPostgresApprovalStore({
    identity,
    trustedTarget,
    attemptedAuthorityTarget: partial.attemptedAuthorityTarget ?? trustedTarget,
    attemptedExecutorTarget: partial.attemptedExecutorTarget ?? trustedTarget,
    lifecycle: partial.lifecycle,
    authority: partial.authority,
    executor: partial.executor,
  });
}
