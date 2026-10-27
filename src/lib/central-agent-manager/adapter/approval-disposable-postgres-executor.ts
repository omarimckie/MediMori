import { approvalDatabaseIdentity } from "../approval-database-identity";
import type { ApprovalSessionObservation } from "./identity-guards";
import { assertApprovalIssuerSession } from "../approval-database-identity";
import {
  disposableVerificationManifest,
  MANDATORY_DISPOSABLE_VERIFICATION_IDS,
  type DisposableVerificationCase,
} from "../verification/disposable-verification-manifest";

export const CAM_APPROVAL_DISPOSABLE_EXECUTE_ENV = "CAM_APPROVAL_DISPOSABLE_EXECUTE";

export type DisposableSqlOutcome = {
  ok: boolean;
  sqlstate?: string;
  rows?: Record<string, unknown>[];
};

export type DisposableApprovalSqlPort = {
  query(sql: string): Promise<DisposableSqlOutcome>;
};

export type DisposableCaseResult = {
  id: string;
  ok: boolean;
  code: string;
  message: string;
  expectedOutcome: DisposableVerificationCase["expectedOutcome"];
};

export type DisposableExecutorReport = {
  ok: boolean;
  executed: DisposableCaseResult[];
  skipped: string[];
};

export function resolveDisposableExecutorEnabled(env: Record<string, string | undefined>): boolean {
  return env[CAM_APPROVAL_DISPOSABLE_EXECUTE_ENV] === "true";
}

export function assertDisposableDatabaseIdentity(observed: ApprovalSessionObservation): void {
  assertApprovalIssuerSession(observed);
  if (observed.projectId !== approvalDatabaseIdentity.projectId) {
    throw new Error("Disposable approval executor project mismatch.");
  }
  if (observed.branchId === "br-wispy-river-b7zzwpij") {
    throw new Error("Orchestration staging branch must not run approval disposable cases.");
  }
}

export function listMandatoryDisposableCases(): DisposableVerificationCase[] {
  return disposableVerificationManifest.filter((case_) =>
    (MANDATORY_DISPOSABLE_VERIFICATION_IDS as readonly string[]).includes(case_.id),
  );
}

export async function runDisposableCaseOffline(
  case_: DisposableVerificationCase,
  port: DisposableApprovalSqlPort,
): Promise<DisposableCaseResult> {
  try {
    for (const sql of case_.sqlOperations) {
      const outcome = await port.query(sql);
      if (case_.expectedOutcome === "success" && !outcome.ok) {
        return {
          id: case_.id,
          ok: false,
          code: "unexpected_sql_failure",
          message: `Case ${case_.id} expected success.`,
          expectedOutcome: case_.expectedOutcome,
        };
      }
      if (case_.expectedOutcome === "error" && outcome.ok) {
        return {
          id: case_.id,
          ok: false,
          code: "expected_sql_error",
          message: `Case ${case_.id} expected error.`,
          expectedOutcome: case_.expectedOutcome,
        };
      }
      if (case_.expectedErrorCode && outcome.sqlstate !== case_.expectedErrorCode) {
        return {
          id: case_.id,
          ok: false,
          code: "wrong_sqlstate",
          message: `Case ${case_.id} expected ${case_.expectedErrorCode}.`,
          expectedOutcome: case_.expectedOutcome,
        };
      }
    }
    return {
      id: case_.id,
      ok: true,
      code: "ok",
      message: `Case ${case_.id} satisfied offline mock.`,
      expectedOutcome: case_.expectedOutcome,
    };
  } catch (error) {
    return {
      id: case_.id,
      ok: false,
      code: "executor_exception",
      message: error instanceof Error ? error.message : "Case failed.",
      expectedOutcome: case_.expectedOutcome,
    };
  }
}

export async function runDisposableExecutorOfflineBatch(input: {
  port: DisposableApprovalSqlPort;
  caseIds?: readonly string[];
}): Promise<DisposableExecutorReport> {
  const cases = listMandatoryDisposableCases().filter((case_) =>
    input.caseIds ? input.caseIds.includes(case_.id) : true,
  );
  const executed: DisposableCaseResult[] = [];
  for (const case_ of cases) {
    const result = await runDisposableCaseOffline(case_, input.port);
    executed.push(result);
    if (!result.ok && case_.stopOnFail) {
      return { ok: false, executed, skipped: cases.slice(executed.length).map((row) => row.id) };
    }
  }
  return { ok: executed.every((row) => row.ok), executed, skipped: [] };
}

export function redactDisposableExecutorReport(report: DisposableExecutorReport): DisposableExecutorReport {
  return {
    ok: report.ok,
    executed: report.executed.map((row) => ({ ...row, message: row.message.replace(/postgresql:\/\/\S+/g, "[redacted]") })),
    skipped: report.skipped,
  };
}
