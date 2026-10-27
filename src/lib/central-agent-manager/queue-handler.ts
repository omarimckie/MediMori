import type { OwnerQueueProjection } from "./orchestration/projections";
import { offlineSimulationProjection } from "./orchestration/offline-simulation";
import {
  isCentralAgentManagerEnabled,
  isCentralAgentManagerOwner,
  isCentralAgentManagerOwnerConfigured,
} from "./owner-auth";

export type QueueHandlerDeps = {
  isEnabled?: () => boolean;
  isOwnerConfigured?: () => boolean;
  getUsername?: () => Promise<string | null>;
  isOwner?: (username: string) => boolean;
  buildProjection?: () => OwnerQueueProjection;
};

export async function centralAgentManagerQueueResponse(
  deps: QueueHandlerDeps = {},
): Promise<Response> {
  const isEnabled = deps.isEnabled ?? isCentralAgentManagerEnabled;
  const isOwnerConfigured = deps.isOwnerConfigured ?? isCentralAgentManagerOwnerConfigured;
  const getUsername = deps.getUsername ?? (async () => null);
  const isOwner = deps.isOwner ?? isCentralAgentManagerOwner;
  const buildProjection = deps.buildProjection ?? offlineSimulationProjection;

  if (!isEnabled()) {
    return Response.json(
      { error: "Central Agent Manager is disabled." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isOwnerConfigured()) {
    return Response.json(
      { error: "Central Agent Manager owner allowlist is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const username = await getUsername();
  if (!username) {
    return Response.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!isOwner(username)) {
    return Response.json({ error: "Forbidden." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  return Response.json(buildProjection(), { headers: { "Cache-Control": "no-store" } });
}
