import { listProjectAdapters } from "./adapters";
import { applyStaleConnection, staleAfterMs } from "./stale";
import type { ManagerStatusPayload } from "./types";

export async function buildManagerStatus(now = new Date()): Promise<ManagerStatusPayload> {
  const adapters = listProjectAdapters();
  const thresholdMs = staleAfterMs();
  const projects = await Promise.all(
    adapters.map(async (adapter) => {
      const snapshot = await adapter.fetchSnapshot();
      return applyStaleConnection(snapshot, now.getTime(), thresholdMs);
    }),
  );

  return {
    generatedAt: now.toISOString(),
    staleAfterMs: thresholdMs,
    projects,
  };
}
