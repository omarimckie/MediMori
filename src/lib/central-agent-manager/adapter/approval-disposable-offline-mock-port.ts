import type { DisposableApprovalSqlPort, DisposableSqlOutcome } from "./approval-disposable-postgres-executor";
import type { DisposableVerificationCase } from "../verification/disposable-verification-manifest";

function isErrorCase(sql: string, case_: DisposableVerificationCase): boolean {
  if (case_.expectedOutcome === "error") return true;
  if (sql.includes("issue_owner_approval") && case_.expectedErrorCode === "operation_not_in_plan") {
    return true;
  }
  if (sql.includes("UPDATE central_agent_manager")) return true;
  if (sql.includes("INSERT central_agent_manager.approvals")) return true;
  if (sql.includes("SET neon.branch_id")) return true;
  return false;
}

export function createOfflineDisposableMockPort(case_: DisposableVerificationCase): DisposableApprovalSqlPort {
  return {
    async query(sql: string): Promise<DisposableSqlOutcome> {
      if (isErrorCase(sql, case_)) {
        return {
          ok: false,
          sqlstate: case_.expectedErrorCode ?? "P0001",
        };
      }
      if (sql.includes("canonical_task_json") || sql.includes("canonical_approval_json")) {
        return { ok: true, rows: [{ digest_hex: "offline-mock" }] };
      }
      if (sql.includes("has_function_privilege") || sql.includes("has_table_privilege")) {
        return { ok: true, rows: [{ privilege: "mock" }] };
      }
      if (sql.includes("pg_class.relrowsecurity") || sql.includes("pg_proc.prosecdef")) {
        return { ok: true, rows: [{ enabled: true }] };
      }
      return { ok: true, rows: [{ mock: true }] };
    },
  };
}
