import type { ConnectionState, ProjectAdapterSnapshot } from "./types";

const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

export function staleAfterMs(): number {
  const raw = process.env.CENTRAL_AGENT_MANAGER_STALE_AFTER_MS?.trim();
  if (!raw) return DEFAULT_STALE_AFTER_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 60_000 || parsed > 24 * 60 * 60 * 1000) {
    return DEFAULT_STALE_AFTER_MS;
  }
  return Math.floor(parsed);
}

export function applyStaleConnection(
  snapshot: ProjectAdapterSnapshot,
  now = Date.now(),
  thresholdMs = staleAfterMs(),
): ProjectAdapterSnapshot {
  if (snapshot.connection !== "connected") return snapshot;
  if (!snapshot.lastSuccessfulUpdate) {
    return {
      ...snapshot,
      connection: "stale",
      connectionDetail: "Connected adapter did not report a last successful update timestamp.",
    };
  }
  const updatedAt = Date.parse(snapshot.lastSuccessfulUpdate);
  if (!Number.isFinite(updatedAt) || now - updatedAt > thresholdMs) {
    return {
      ...snapshot,
      connection: "stale",
      connectionDetail: `Last successful update is older than ${thresholdMs} ms.`,
    };
  }
  return snapshot;
}

export function disconnectedSnapshot(
  projectId: ProjectAdapterSnapshot["projectId"],
  displayName: string,
  detail: string,
): ProjectAdapterSnapshot {
  return {
    projectId,
    displayName,
    connection: "disconnected",
    connectionDetail: detail,
    activeAgents: [],
    tasks: [],
    pendingApprovals: [],
    lastSuccessfulUpdate: null,
    evidence: [],
  };
}

export function unavailableSnapshot(
  projectId: ProjectAdapterSnapshot["projectId"],
  displayName: string,
  detail: string,
): ProjectAdapterSnapshot {
  return {
    projectId,
    displayName,
    connection: "unavailable",
    connectionDetail: detail,
    activeAgents: [],
    tasks: [],
    pendingApprovals: [],
    lastSuccessfulUpdate: null,
    evidence: [],
  };
}

export function connectedSnapshot(
  base: Omit<ProjectAdapterSnapshot, "connection" | "connectionDetail"> & {
    connectionDetail?: string;
  },
): ProjectAdapterSnapshot {
  return {
    ...base,
    connection: "connected" satisfies ConnectionState,
    connectionDetail: base.connectionDetail ?? "Adapter reported live status.",
  };
}
