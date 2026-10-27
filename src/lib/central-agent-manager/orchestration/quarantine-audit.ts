import type { OrchestrationSqlQuarantineRow } from "./orchestration-sql-port";

export type OrchestrationSourceTable =
  | "orchestration_jobs"
  | "orchestration_assignments"
  | "orchestration_agents";

export function orchestrationQuarantineId(sourceTable: OrchestrationSourceTable, recordId: string): string {
  const suffix =
    sourceTable === "orchestration_jobs"
      ? "job"
      : sourceTable === "orchestration_assignments"
        ? "assignment"
        : "agent";
  return `quarantine-${suffix}-${recordId}`;
}

export function quarantinedRecordKey(sourceTable: string, recordId: string): string {
  return `${sourceTable}:${recordId}`;
}

export function indexQuarantinedSourceKeys(rows: readonly OrchestrationSqlQuarantineRow[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const recordId = parseQuarantinedRecordId(row);
    if (recordId) keys.add(quarantinedRecordKey(row.source_table, recordId));
  }
  return keys;
}

function parseQuarantinedRecordId(row: OrchestrationSqlQuarantineRow): string | null {
  if (row.id.startsWith("quarantine-job-")) return row.id.slice("quarantine-job-".length);
  if (row.id.startsWith("quarantine-assignment-")) return row.id.slice("quarantine-assignment-".length);
  if (row.id.startsWith("quarantine-agent-")) return row.id.slice("quarantine-agent-".length);
  try {
    const parsed = JSON.parse(row.payload_json) as { id?: string };
    return parsed.id?.trim() || null;
  } catch {
    return null;
  }
}
