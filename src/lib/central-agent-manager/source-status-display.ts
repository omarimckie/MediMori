import type { ProjectAdapterSnapshot, ProjectSourceReport } from "./types";

export function formatProgressPercent(source: ProjectSourceReport | undefined): string {
  if (!source || source.progressPercent === null) return "Unknown (not reported by source)";
  return `${source.progressPercent}%`;
}

export function formatOptionalSourceField(value: string | null | undefined): string {
  if (value === null || value === undefined || !value.trim()) {
    return "Not reported";
  }
  return value;
}

export function pendingApprovalLabel(count: number): string {
  if (count <= 0) return "None reported";
  return count === 1 ? "1 pending (read-only)" : `${count} pending (read-only)`;
}

export function connectionStatusLabel(connection: ProjectAdapterSnapshot["connection"]): string {
  switch (connection) {
    case "connected":
      return "Live (source-connected)";
    case "stale":
      return "Stale (not current)";
    case "disconnected":
      return "Disconnected";
    case "unavailable":
      return "Unavailable";
    default:
      return connection;
  }
}

export function collectProjectBlockers(project: ProjectAdapterSnapshot): string[] {
  return project.tasks.flatMap((task) => task.blockers.map((blocker) => blocker.summary));
}
