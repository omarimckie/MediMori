import type { ManagerStatusPayload } from "./types";
import {
  isCentralAgentManagerEnabled,
  isCentralAgentManagerOwner,
  isCentralAgentManagerOwnerConfigured,
} from "./owner-auth";
import { scrubManagerStatusPayload } from "./scrub-response";

export type StatusBuildContext = {
  username: string;
  refresh: boolean;
};

export type StatusHandlerDeps = {
  isEnabled?: () => boolean;
  isOwnerConfigured?: () => boolean;
  getUsername?: () => Promise<string | null>;
  isOwner?: (username: string) => boolean;
  refresh?: boolean;
  buildStatus?: (context: StatusBuildContext) => Promise<ManagerStatusPayload>;
};

export async function centralAgentManagerStatusResponse(
  deps: StatusHandlerDeps = {},
): Promise<Response> {
  const isEnabled = deps.isEnabled ?? isCentralAgentManagerEnabled;
  const isOwnerConfigured = deps.isOwnerConfigured ?? isCentralAgentManagerOwnerConfigured;
  const getUsername = deps.getUsername ?? (async () => null);
  const isOwner = deps.isOwner ?? isCentralAgentManagerOwner;
  const buildStatus =
    deps.buildStatus ??
    (async () => ({ generatedAt: "", staleAfterMs: 0, projects: [] }));

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
    return Response.json(
      { error: "Unauthorized." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isOwner(username)) {
    return Response.json(
      { error: "Forbidden." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const status = scrubManagerStatusPayload(
    await buildStatus({ username, refresh: deps.refresh ?? false }),
  );
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
